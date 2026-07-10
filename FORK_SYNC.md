# Fork synchronization

`origin` is the maintained LiGoldragon fork and `upstream` is
`nicobailon/pi-subagents`. Fetch upstream before reliability work, develop fork
changes on a named branch, and merge upstream `main` through a tested branch.
Keep downstream consumers pinned to an immutable fork commit rather than an npm
tarball or a local checkout.
