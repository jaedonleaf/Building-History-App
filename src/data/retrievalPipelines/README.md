# Modular Data Retrieval Pipelines

This folder contains the source-independent retrieval architecture for building history.

Each pipeline retrieves one aspect of the final building profile:

- identity/name resolution
- location/address validation
- source discovery/source routing
- build date/age
- why it was built
- current use
- previous use
- listed status
- cool historical event
- source confidence/conflict handling

Source packs should be added as adapters. A source adapter receives the current pipeline and context, then returns source-backed evidence and source-check diagnostics:

```js
{
  collect({ pipeline, context }) {
    return {
      evidence: [],
      checks: [],
    };
  },
}
```

Every displayed fact must come from evidence with a source URL. Unknown fields stay `null` with uncertainty notes.
