# CrossDoc Architecture

CrossDoc is designed around a sharp boundary:

- The **review pipeline** owns the domain logic.
- **Pi** owns the runtime loop, model abstraction, and tool scheduling.

## Pipeline

```text
PDFs
  -> parse_doc
  -> extract_claims
  -> compare_claims
  -> verify_conflicts
  -> report_conflicts
  -> Markdown report
```

## Evidence Contract

Every claim carries:

- document id
- absolute document path
- page number
- quote
- confidence

Every conflict is derived from two claims and repeats their evidence. This keeps review output auditable even before LLM-based extraction is introduced.

## Pi Boundary

`src/agent.ts` exports:

- `createCrossDocTools()`
- `createCrossDocAgent()`

The rest of the codebase does not import Pi. That keeps the review engine portable if Pi APIs change or if another runtime is evaluated later.
