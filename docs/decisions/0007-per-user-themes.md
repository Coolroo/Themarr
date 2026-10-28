# 0007: Per-user themes: layers, one prefs file, and the conflict rules

Date: 2026-10-28. Task: T-089. Asked by: the owner, round 3 of the plan
(2026-10-24, [Themarr plan: users and preferences](https://docs.coolroo.dev/doc/themarr-plan-users-and-preferences-fvX2u1eAmC)):
"Per-user themes, layered and not monolithic."

## Decision

- **The layers, top down; the first that is set wins:**
  1. *enforced*: an admin's enforced policy for the person or one of their
     groups. Nothing below can change it, so the answer says `locked: true`;
  2. the *local override* in that browser (the SDK only; ignored when
     locked);
  3. *saved*: the person's own choice for that app;
  4. *default*: an admin's default policy for the person or one of their
     groups;
  5. *app*: the app's assignment (`none` stops here), then *global*: the
     global default;
  6. nothing (204): the app keeps its own look.
- **One function per layer** in `internal/resolve` (`Enforced`, `Saved`,
  `Default`, `App`, `Global`), run in the order of `resolve.Layers`. A layer
  is added or removed by changing that list and its own function; no other
  layer changes. The public route runs the same resolver without a person,
  so only `App` and `Global` can decide there.
- **Conflict rules inside a layer:**
  - the person's own policy beats a group policy of the same kind;
  - among the person's groups, the group whose name sorts first in byte
    order wins (`Zed` before `alpha`), whatever order Authelia lists them
    in;
  - layers come before people: a group's *enforced* policy beats the
    person's own *default*;
  - a policy or choice that names a theme that no longer exists is skipped;
    the next candidate, then the next layer, is asked.
- **Policies are for every app**, registered or not, and above the app's
  assignment, so an enforced or default policy also themes an app assigned
  `none`.
- **Identity is a module.** `identity.Source` has one method,
  `Identify(r) (Identity, ok)`. The first module, `identity.Authelia`,
  reads `Remote-User` and `Remote-Groups` with the strict checks the admin
  routes had (one `Remote-User` of 1-128 `A-Za-z0-9._@-`; `Remote-Groups`
  at most once). It is trusted only behind the CN gate. Authelia stays the
  only source of who someone is and their groups; themarr stores names in
  choices and policies, never group membership.
- **One file, `prefs.json`,** beside `themarr.json`, holds the saved choices
  (user → app → theme) and the user and group policies, with its own
  version. The ETag is `"p<version>"`, so it can never be mistaken for the
  store's `"<version>"`. It keeps the store's rules: a temp file in the same
  directory, fsync, rename, fsync of the directory (`store.WriteAtomic`),
  one writer at a time, `If-Match` on every write, and a file that can't be
  read stops the start and is left as it is.
- **Themes and prefs stay in separate files.** A theme deleted later can
  still be named in `prefs.json`. Deleting a theme a policy names is
  refused (`409 in_use`, through `server.Options.ThemeInUse`); a saved
  choice never blocks a delete. The check and the delete hold different
  locks, so a policy written at that same moment can still name the
  deleted theme; the resolver skips it.
- **A person may always clear their choice,** even while locked; setting a
  theme while locked is `409 locked`. Choices are kept only for registered
  apps.

## Why

- **Layers match how people think about it:** an admin can force a theme
  (a kiosk, a child's account), suggest one (a default), or leave it to the
  person; the person's own choice follows them across devices, and a local
  override is for one browser only.
- **Deterministic group order** makes the answer the same on every request
  and every device. Name order is simple to explain on the People screen
  and needs no extra field; a priority field can come later if the owner
  wants one.
- **One file instead of `users/<user>.json` and `groups/<group>.json`**
  (the first plan): one version and one atomic write cover a policy change
  and every choice it affects, there is one file to back up and check at
  start, and the data is small (a homelab's users). Many small files would
  need a version per file, a directory scan at start, and file names built
  from user names (a path risk). The first cost was that every write
  shared one version, so one person saving in a loop made every admin's
  policy write fail with 412 (the T-115 review). Since 0.1.0 a write
  checks `If-Match` only against the last change of its own part (the
  policies, or one person's choice for one app), kept in memory; the
  routes and the file format did not change.
- **Two files, not the store:** themes are an admin's work, edited from the
  admin UI; choices are written by every signed-in person. Keeping them
  apart keeps the store's version (the admin UI's `If-Match`) from changing
  each time somebody picks a theme.

## Rejected

- **Storing preferences in Authelia:** Authelia has no place for app
  settings.
- **A user's default beating a group's enforced policy:** it would let any
  per-user default undo a group lock, which is what *enforced* is for.
- **Map order or Authelia's group order:** not stable across requests.
- **Deleting choices and policies with their theme:** an admin's policy
  silently gone is worse than a clear 409; choices are skipped instead, so
  the person keeps their history if the theme comes back.
