# Benchmark descriptors

Put public collections under `warrior_public/`, preserving their subdirectories.
Each selectable suite has a file ending in `.benchmark.json` in its directory:

```json
{
  "version": 1,
  "name": "My Nano Benchmark",
  "parameters": {
    "coreSize": 80,
    "cycles": 800,
    "tasks": 80,
    "maxLength": 5,
    "distance": 5,
    "rounds": 100
  },
  "warriors": ["first.red", "second.red"]
}
```

Warrior paths are relative to the descriptor and cannot escape its directory.
List files explicitly to preserve suite membership and ordering. Keep source
attribution and collection README files alongside them. The build packages only
suites with descriptors; it does not guess rules from folder names.

Parameters: `coreSize`, `cycles`, `tasks`, `maxLength`, `distance`, `pspace`,
`rules88`, `noPspace`, `formula`, and `rounds`. Omitted settings use pMARS defaults;
omitted rounds defaults to 100. Descriptors can also retain descriptive metadata
such as `description`, `sourceUrl`, and `retrievedAt`.

Selecting a suite (or applying an edited descriptor) sets its default rounds.
The editable Rounds per matchup field overrides that default for the next run.
Other suite parameters take precedence over the shared emulator settings.
The tournament seed still controls placement.

## Session imports

In Benchmark mode choose Import benchmark and select exactly one JSON descriptor
and its warrior files together. Import folder supports nested paths. The suite
appears in the dropdown without changing the emulator roster. Expand Suite details
to inspect opponents or edit the descriptor; changes are local to this session.
Download descriptor saves edited metadata; retain the warrior sources separately.
An import with missing, duplicate, or unsafe paths is rejected without replacing
existing suites. Up to 500 opponents, 64 KiB per source, are supported.

Self fights includes a warrior against itself in round robin/Challenge. In
Benchmark mode it includes opponents whose source text exactly matches the
candidate; unchecked skips those entries. It does not use warrior names as an
identity test. Melee ignores this option because all entrants already share a core.
