import type { ImportIssue, IssueSeverity, SourceReference } from '../domain/schemas';

/** Coletor de problemas de importação com ids estáveis por arquivo. */
export class IssueCollector {
  readonly issues: ImportIssue[] = [];
  private seq = 0;

  constructor(private readonly prefix: string) {}

  add(severity: IssueSeverity, category: ImportIssue['category'], message: string, source?: SourceReference): ImportIssue {
    const issue: ImportIssue = { id: `${this.prefix}-${++this.seq}`, severity, category, message, source };
    this.issues.push(issue);
    return issue;
  }

  blocker(category: ImportIssue['category'], message: string, source?: SourceReference) {
    return this.add('bloqueador', category, message, source);
  }

  warn(category: ImportIssue['category'], message: string, source?: SourceReference) {
    return this.add('aviso', category, message, source);
  }

  info(category: ImportIssue['category'], message: string, source?: SourceReference) {
    return this.add('info', category, message, source);
  }
}
