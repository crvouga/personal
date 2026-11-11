export interface CommandSpec {
  id: string;
  title: string;
  description: string;
  group: string;
  keywords: string[];
  args: string[];
  examples: string[];
  mutation: boolean;
}

export interface CommandOutcome {
  exitCode: number;
  data: unknown;
  text?: string;
}
