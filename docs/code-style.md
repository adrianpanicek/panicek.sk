# Source readability

Follow the [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html)
for TypeScript and TSX source. Use whitespace to show the structure of the code.

The TypeScript override in `.prettierrc.json` follows
[Google's gts formatter settings](https://github.com/google/gts/blob/main/.prettierrc.json):
single quotes, trailing commas, no spaces inside object/import braces, and omitted
arrow parameter parentheses when possible. It uses an 80-column wrapping target,
two-space indentation, and semicolons. The wrapping target is a formatter setting,
not a hard line-length requirement in the guide. Other file types keep their
existing formatting.

Prettier does not enforce every rule in the guide. When editing control flow, use
braced bodies, including short branches, so wrapping cannot create an unbraced
multiline statement. Keep one blank line after imports and between methods, and
no blank lines at the start or end of function bodies.

- Put one blank line between functions, components, type declarations, and distinct
  steps within a function. Keep closely related declarations together.
- Separate setup, validation, transformation, effects, and the final return when
  those are distinct steps. Give each React effect its own visual block.
- Use descriptive names for conditions and limits. A reader should not need to
  decode a compound expression or infer the meaning of a numeric threshold.
- Prefer an explicit branch to a nested conditional expression. Short ternaries
  are useful when they clearly select between two values.
- Extract a helper or component when it names a coherent responsibility and makes
  its caller easier to understand. Keep related code together; avoid creating tiny
  files solely to shorten a component.
- Keep parsing and state transformations separate from JSX and browser effects.
  Comments should explain a constraint or reason, such as why scrollback always
  retains the newest entry.
- Preserve existing behavior during readability refactors. Use existing tests,
  adding coverage for meaningful boundaries when needed.

For example:

```ts
const text = entryText(entry);
lineCount += text.split('\n').length;
characterCount += text.length;

const exceedsLimit = lineCount > MAX_LINES || characterCount > MAX_CHARACTERS;

if (exceedsLimit) {
  keepFrom = index + 1;
  break;
}
```

Prettier handles indentation, wrapping, and punctuation. It preserves intentional
single blank lines, but does not decide where logical groups begin. Review those
boundaries when editing. Use `bun run format:check` to check formatting.
