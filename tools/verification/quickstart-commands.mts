/** Read executable examples only; prose and non-shell fences are not commands. */
export function quickstartCommands(markdown: string): readonly string[] {
  const commands = new Set<string>();
  let fence: string | undefined;
  let shell = false;
  for (const raw of markdown.split(/\r?\n/u)) {
    const line = raw.trim();
    if (fence) {
      if (line.startsWith(fence) && /^(`+|~+)\s*$/u.test(line)) {
        fence = undefined;
        shell = false;
      } else if (shell && /^(?:corepack enable|pnpm )/u.test(line)) {
        commands.add(line);
      }
      continue;
    }
    const opening = /^(`{3,}|~{3,})(\S*)\s*$/u.exec(line);
    if (opening) {
      fence = opening[1];
      shell = ["bash", "sh", "shell", "zsh"].includes(opening[2]!);
    }
  }
  return Object.freeze([...commands]);
}
