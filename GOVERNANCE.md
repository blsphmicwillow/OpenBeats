# Governance

OpenBeats started as a solo project. This document exists so it does not stay
one: it describes who decides what, how decisions are made, and how someone
joins the maintainers. It applies to the repository, issues, pull requests,
Discussions and any other project space.

## Principles

- **The code is the project.** Anything shipped in this repository must be
  buildable from source with the documented steps.
- **Users and contributors are the point.** A change that makes contributions
  harder needs a very good reason.
- **Decisions are public.** Design arguments belong in an issue or pull request,
  not in a private chat, unless they are security reports or code of conduct
  matters.
- **No gatekeeping for its own sake.** Small fixes and documentation do not need
  a design discussion first.

## Roles

### Contributor

Anyone who opens an issue, reports a bug on hardware, improves documentation,
translates strings, submits a theme or sample pack, or sends a pull request.

### Reviewer

A contributor trusted to review pull requests in an area (for example the audio
engine, the interface, packaging or translations). Reviewers can approve changes
but cannot merge them alone until they become maintainers.

### Maintainer

A maintainer can merge pull requests, triage issues, manage labels and
milestones, and take part in decisions listed below. Maintainers are expected to:

- Review pull requests in their area within about 7 days, or say when they
  cannot.
- Keep `main` buildable and the CI checks meaningful.
- Follow the [Code of Conduct](CODE_OF_CONDUCT.md) and enforce it.
- Say clearly when something is untested, especially audio behaviour that needs
  real hardware.

### Release manager

One maintainer at a time owns a release: version numbers, the changelog, the
tag, the CI release run and the published notes. The role rotates only by
agreement. The current release manager is the project founder.

## Current maintainers

| GitHub | Role | Areas |
| --- | --- | --- |
| [@blsphmicwillow](https://github.com/blsphmicwillow) | Maintainer, release manager | Everything |

This table is the authoritative list. It is updated in the same pull request
that grants or removes the role.

## How decisions are made

OpenBeats uses **lazy consensus**:

1. Someone opens an issue or pull request describing the change and its
   trade-offs.
2. If nobody objects within 7 days, and CI passes, a maintainer may merge it or
   start work.
3. If there is an objection, the people involved discuss it in the issue or pull
   request and try to reach a compromise.
4. If no compromise is reached, the maintainers decide. A maintainer who
   disagrees can ask for a vote; a simple majority of maintainers decides, and
   the reasoning is posted on the issue.

Some decisions do not wait for consensus:

- **Security fixes** may be prepared and merged privately, then disclosed under
  the [security policy](SECURITY.md).
- **Release mechanics** (version bumps, changelog wording, tag timing) belong to
  the release manager.
- **Code of conduct enforcement** is handled by the maintainers without a public
  debate about the people involved.

Changes that need an explicit decision, not a silent merge:

- The licence or the licensing of any crate or asset.
- The governance in this file.
- Adding or removing a maintainer.
- A new external service, account requirement, telemetry or network request.
- Dropping a platform, an installer format or a file format.

## Becoming a maintainer

There is no application form and no fee. The usual path is:

1. Contribute consistently. Merged code, careful reviews, reproduced bugs,
   hardware test reports, translations and documentation all count.
2. A maintainer invites you to be a reviewer for the area you know best.
3. After a track record of reviews and merged changes, any maintainer can
   nominate you as a maintainer in a public issue.
4. If no maintainer objects within 7 days, the nomination passes. The new
   maintainer is added to the table above and, if they accept, to the repository
   with merge access.

The goal is at least two maintainers with release access, so the project does
not depend on one person's availability. Repository and release access is
granted by the owner; a maintainer who has run at least two releases is eligible
to hold it.

A maintainer who becomes inactive for 12 months may be moved to an emeritus
list, with the option to return without re-applying.

## Releases

- Releases follow [docs/RELEASING.md](docs/RELEASING.md) and are built by CI from
  a tag.
- A release is published only when the platform jobs pass. A failed job is fixed
  or the release is held; it is not hand-waved.
- Release notes state what was tested, on which platform, and what was not. The
  project's rule is that an untested claim is labelled as untested.
- Anyone may propose a release date. The release manager sets the final one.

## Conflict resolution

1. Discuss the technical question in the issue or pull request.
2. If the discussion stalls, ask a maintainer who has not yet taken a side to
   summarise the options.
3. If it is about behaviour, not code, follow the
   [Code of Conduct](CODE_OF_CONDUCT.md). Do not litigate it in the issue.
4. Maintainers may lock a thread or remove comments that violate the code of
   conduct. Reasons are given when it is safe to do so.

## Changing this document

Open this file as a pull request. The change follows lazy consensus with a 7-day
comment period, and needs approval from a maintainer who is not the author.

## What this document does not do

- It does not create a company, foundation or legal entity.
- It does not require a copyright assignment or a contributor licence agreement.
  Contributions are accepted under the project licence with a Developer
  Certificate of Origin sign-off; see [CONTRIBUTING.md](CONTRIBUTING.md).
- It does not promise a roadmap or a release date. [ROADMAP.md](ROADMAP.md)
  describes intent, not a contract.
