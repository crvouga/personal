/** Displayed resume commands are shell code too: JSON quoting permits $(). */
export function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}
export function scopedCommand(command: string, directory: string): string {
  return command.replaceAll(
    /bun run password-manager (?:--state-dir (?:'(?:[^']|'\\'')*'|\S+) )?/g,
    () => `bun run password-manager --state-dir ${shellQuote(directory)} `
  );
}
