//! Modular effect graph (Patcher-style routing).
//!
//! Nodes are processing blocks with any number of inputs; connections sum their
//! source outputs into a destination. The graph is resolved to a topological
//! order once, so cycles are rejected before audio is processed and each block
//! is evaluated after the blocks feeding it.

use serde::{Deserialize, Serialize};

/// A processing block.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum NodeKind {
    /// Linear gain.
    Gain { gain: f32 },
    /// One-pole low-pass.
    Lowpass { cutoff_hz: f32 },
    /// One-pole high-pass.
    Highpass { cutoff_hz: f32 },
    /// Soft saturation.
    Drive { amount: f32 },
}

impl NodeKind {
    fn apply(&self, x: f32, state: &mut f32, sample_rate: f32) -> f32 {
        match *self {
            NodeKind::Gain { gain } => x * gain,
            NodeKind::Lowpass { cutoff_hz } => {
                let coef = one_pole(sample_rate, cutoff_hz);
                *state = x * (1.0 - coef) + *state * coef;
                *state
            }
            NodeKind::Highpass { cutoff_hz } => {
                let coef = one_pole(sample_rate, cutoff_hz);
                *state = x * (1.0 - coef) + *state * coef;
                x - *state
            }
            NodeKind::Drive { amount } => {
                let drive = 1.0 + amount.max(0.0) * 12.0;
                (x * drive).tanh() / drive.tanh().max(1e-6)
            }
        }
    }
}

fn one_pole(sample_rate: f32, cutoff_hz: f32) -> f32 {
    let cutoff = cutoff_hz.clamp(10.0, sample_rate * 0.45);
    (-2.0 * std::f32::consts::PI * cutoff / sample_rate.max(1.0)).exp()
}

/// A node in the graph.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize)]
pub struct Node {
    pub id: usize,
    pub kind: NodeKind,
}

impl Node {
    pub fn new(id: usize, kind: NodeKind) -> Self {
        Self { id, kind }
    }
}

/// A connection from one node's output to another node's input.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
pub struct Connection {
    pub from: usize,
    pub to: usize,
}

/// Graph problems that must stop processing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GraphError {
    UnknownNode(usize),
    Cycle(Vec<usize>),
    Empty,
}

impl std::fmt::Display for GraphError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GraphError::UnknownNode(id) => write!(f, "effect node {id} does not exist"),
            GraphError::Cycle(ids) => write!(f, "effect graph cycle: {ids:?}"),
            GraphError::Empty => write!(f, "the effect graph has no nodes"),
        }
    }
}

/// A modular effect graph.
#[derive(Debug, Clone, Default, PartialEq, Deserialize, Serialize)]
pub struct ModularGraph {
    pub nodes: Vec<Node>,
    pub connections: Vec<Connection>,
    /// Per-node filter memory, kept out of `PartialEq` so graphs stay comparable.
    #[serde(skip)]
    state: Vec<f32>,
}

impl ModularGraph {
    pub fn new(nodes: Vec<Node>, connections: Vec<Connection>) -> Self {
        let state = vec![0.0; nodes.len()];
        Self {
            nodes,
            connections,
            state,
        }
    }

    fn index_of(&self, id: usize) -> Option<usize> {
        self.nodes.iter().position(|n| n.id == id)
    }

    /// Nodes in evaluation order; every node follows the nodes feeding it.
    pub fn order(&self) -> Result<Vec<usize>, GraphError> {
        if self.nodes.is_empty() {
            return Err(GraphError::Empty);
        }
        let count = self.nodes.len();
        let mut edges: Vec<Vec<usize>> = vec![Vec::new(); count];
        let mut indegree = vec![0usize; count];
        for connection in &self.connections {
            let Some(from) = self.index_of(connection.from) else {
                return Err(GraphError::UnknownNode(connection.from));
            };
            let Some(to) = self.index_of(connection.to) else {
                return Err(GraphError::UnknownNode(connection.to));
            };
            if from == to {
                return Err(GraphError::Cycle(vec![connection.from]));
            }
            edges[from].push(to);
            indegree[to] += 1;
        }

        let mut ready: Vec<usize> = (0..count).filter(|i| indegree[*i] == 0).collect();
        let mut order = Vec::with_capacity(count);
        while let Some(node) = ready.pop() {
            order.push(self.nodes[node].id);
            for to in &edges[node] {
                indegree[*to] -= 1;
                if indegree[*to] == 0 {
                    ready.push(*to);
                }
            }
        }
        if order.len() != count {
            let stuck: Vec<usize> = (0..count)
                .filter(|i| !order.contains(&self.nodes[*i].id))
                .map(|i| self.nodes[i].id)
                .collect();
            return Err(GraphError::Cycle(stuck));
        }
        Ok(order)
    }

    /// Processes one sample through the graph.
    ///
    /// Nodes with no incoming connection receive the graph input; the result is
    /// the sum of the sink nodes. Node state (filters) is kept between calls and
    /// `sample_rate` is only used for the cutoff coefficients.
    pub fn process(&mut self, input: f32, sample_rate: f32) -> Result<f32, GraphError> {
        let order = self.order()?;
        let count = self.nodes.len();
        let mut values = vec![0.0f32; count];
        let mut has_incoming = vec![false; count];
        let mut has_outgoing = vec![false; count];
        for connection in &self.connections {
            if let Some(to) = self.index_of(connection.to) {
                has_incoming[to] = true;
            }
            if let Some(from) = self.index_of(connection.from) {
                has_outgoing[from] = true;
            }
        }

        for id in order {
            let index = self.index_of(id).ok_or(GraphError::UnknownNode(id))?;
            let mut sum = if has_incoming[index] { 0.0 } else { input };
            for connection in &self.connections {
                if connection.to == id {
                    if let Some(from) = self.index_of(connection.from) {
                        sum += values[from];
                    }
                }
            }
            let mut state = self.state.get(index).copied().unwrap_or(0.0);
            values[index] = self.nodes[index].kind.apply(sum, &mut state, sample_rate);
            if index < self.state.len() {
                self.state[index] = state;
            }
        }

        let mut out = 0.0;
        for (index, _) in self.nodes.iter().enumerate() {
            if !has_outgoing[index] {
                out += values[index];
            }
        }
        Ok(out)
    }

    /// Clears filter state (used when the graph is rebuilt).
    pub fn reset(&mut self) {
        self.state = vec![0.0; self.nodes.len()];
    }

    /// Adds a node and returns its id.
    pub fn add_node(&mut self, kind: NodeKind) -> usize {
        let id = self
            .nodes
            .iter()
            .map(|n| n.id)
            .max()
            .map(|m| m + 1)
            .unwrap_or(0);
        self.nodes.push(Node::new(id, kind));
        self.state.push(0.0);
        id
    }

    /// Connects two nodes, rejecting unknown ids.
    pub fn connect(&mut self, from: usize, to: usize) -> Result<(), GraphError> {
        if self.index_of(from).is_none() {
            return Err(GraphError::UnknownNode(from));
        }
        if self.index_of(to).is_none() {
            return Err(GraphError::UnknownNode(to));
        }
        self.connections.push(Connection { from, to });
        if self.state.len() < self.nodes.len() {
            self.state.resize(self.nodes.len(), 0.0);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gain(id: usize, gain: f32) -> Node {
        Node::new(id, NodeKind::Gain { gain })
    }

    #[test]
    fn a_serial_chain_multiplies_the_gains() {
        let mut graph = ModularGraph::new(
            vec![gain(0, 2.0), gain(1, 2.0)],
            vec![Connection { from: 0, to: 1 }],
        );
        let out = graph.process(0.1, 48_000.0).unwrap();
        assert!((out - 0.4).abs() < 1e-6, "got {out}");
    }

    #[test]
    fn parallel_paths_are_summed() {
        let mut graph = ModularGraph::new(
            vec![gain(0, 2.0), gain(1, 3.0), gain(2, 1.0)],
            vec![Connection { from: 0, to: 2 }, Connection { from: 1, to: 2 }],
        );
        // Both sources get the graph input; node 2 sums them.
        let out = graph.process(0.5, 48_000.0).unwrap();
        assert!((out - 2.5).abs() < 1e-6, "got {out}");
    }

    #[test]
    fn a_cycle_is_rejected() {
        let mut graph = ModularGraph::new(
            vec![gain(0, 1.0), gain(1, 1.0)],
            vec![Connection { from: 0, to: 1 }, Connection { from: 1, to: 0 }],
        );
        assert!(matches!(graph.order(), Err(GraphError::Cycle(_))));
        assert!(graph.process(0.0, 48_000.0).is_err());
    }

    #[test]
    fn unknown_nodes_are_rejected() {
        let mut graph = ModularGraph::new(vec![gain(0, 1.0)], vec![Connection { from: 0, to: 7 }]);
        assert_eq!(graph.order(), Err(GraphError::UnknownNode(7)));
        assert_eq!(graph.connect(0, 9), Err(GraphError::UnknownNode(9)));
    }

    #[test]
    fn an_empty_graph_is_rejected() {
        assert_eq!(ModularGraph::default().order(), Err(GraphError::Empty));
    }

    #[test]
    fn a_lowpass_passes_dc_and_attenuates_highs() {
        let mut low = ModularGraph::new(
            vec![Node::new(0, NodeKind::Lowpass { cutoff_hz: 200.0 })],
            vec![],
        );
        let mut dc = 0.0;
        // A one-pole settles towards the input over its time constant.
        for _ in 0..4_800 {
            dc = low.process(1.0, 48_000.0).unwrap();
        }
        assert!(dc > 0.9, "DC was attenuated: {dc}");

        let mut fast = ModularGraph::new(
            vec![Node::new(0, NodeKind::Lowpass { cutoff_hz: 200.0 })],
            vec![],
        );
        let mut peak = 0.0f32;
        let mut phase = 0.0f32;
        for _ in 0..4_800 {
            phase += 2.0 * std::f32::consts::PI * 8_000.0 / 48_000.0;
            peak = peak.max(fast.process(phase.sin(), 48_000.0).unwrap().abs());
        }
        assert!(peak < 0.3, "8 kHz was not attenuated: {peak}");
    }

    #[test]
    fn a_highpass_removes_dc() {
        let mut graph = ModularGraph::new(
            vec![Node::new(0, NodeKind::Highpass { cutoff_hz: 200.0 })],
            vec![],
        );
        let mut last = 1.0;
        for _ in 0..48_000 {
            last = graph.process(1.0, 48_000.0).unwrap();
        }
        assert!(last.abs() < 0.01, "DC leaked through: {last}");
    }

    #[test]
    fn drive_saturates_hot_signals() {
        let mut graph =
            ModularGraph::new(vec![Node::new(0, NodeKind::Drive { amount: 1.0 })], vec![]);
        let out = graph.process(4.0, 48_000.0).unwrap();
        assert!(out < 4.0, "drive did not compress: {out}");
        assert!(out > 0.5, "drive crushed the signal: {out}");
    }

    #[test]
    fn added_nodes_get_unique_ids_and_receive_input() {
        let mut graph = ModularGraph::default();
        let a = graph.add_node(NodeKind::Gain { gain: 2.0 });
        let b = graph.add_node(NodeKind::Gain { gain: 2.0 });
        assert_ne!(a, b);
        graph.connect(a, b).unwrap();
        let out = graph.process(0.25, 48_000.0).unwrap();
        assert!((out - 1.0).abs() < 1e-6, "got {out}");
    }
}
