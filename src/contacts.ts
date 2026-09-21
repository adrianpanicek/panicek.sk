/** Decode display tokens only; persisted files and shell streams stay encoded. */
export function decodeContactTokens(text: string): string {
  return text.replace(/\{\{(rot13|rot47):([^\r\n]*?)\}\}/g, (_, encoding: string, value: string) =>
    encoding === 'rot47'
      ? value.replace(/[!-~]/g, (character) =>
          String.fromCharCode(33 + ((character.charCodeAt(0) - 33 + 47) % 94)),
        )
      : value.replace(/[a-zA-Z]/g, (character) => {
          const start = character <= 'Z' ? 65 : 97;
          return String.fromCharCode(start + ((character.charCodeAt(0) - start + 13) % 26));
        }),
  );
}
