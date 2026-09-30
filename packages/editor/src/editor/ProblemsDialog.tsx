/**
 * `ovd validate` on the open project (spec §10, #68), in the editor: every problem, and a click
 * takes you to the element it names. Runs on what is on screen, unsaved edits included.
 */
import { type Issue, validateProject } from '@workspace/ovd-core';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@workspace/ui/components/dialog';
import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react';
import { useMemo } from 'react';
import { editor, useEditor } from '../state/store';

function reveal(issue: Issue): boolean {
    const s = editor();
    const kind = s.project?.pages.some((p) => p.file === issue.file)
        ? 'page'
        : s.project?.components.some((c) => c.file === issue.file)
          ? 'component'
          : null;
    if (!kind) return false;
    s.openDoc({ kind, file: issue.file });
    if (issue.id) s.select([issue.id]);
    return true;
}

export function ProblemsDialog({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const project = useEditor((s) => s.project);
    // Validated when opened, on the project as it is then.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run on open, not on every edit
    const issues = useMemo(() => (open && project ? validateProject(project) : []), [open]);
    const errors = issues.filter((i) => i.severity === 'error').length;
    const warnings = issues.length - errors;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>Validation</DialogTitle>
                    <DialogDescription>
                        {issues.length
                            ? `${errors} error(s), ${warnings} warning(s) found by ovd validate.`
                            : 'No problems found by ovd validate.'}
                    </DialogDescription>
                </DialogHeader>
                {issues.length === 0 ? (
                    <CircleCheck className="text-primary mx-auto size-8" aria-hidden />
                ) : (
                    <ul
                        aria-label="Problems"
                        className="max-h-80 divide-y overflow-auto rounded border"
                    >
                        {issues.map((issue, i) => {
                            const Icon = issue.severity === 'error' ? CircleAlert : TriangleAlert;
                            return (
                                <li key={i}>
                                    <button
                                        className="hover:bg-accent flex w-full items-start gap-2 px-2.5 py-2 text-left text-xs"
                                        onClick={() => reveal(issue) && onOpenChange(false)}
                                    >
                                        <Icon
                                            className={
                                                issue.severity === 'error'
                                                    ? 'text-destructive mt-0.5 size-3.5 shrink-0'
                                                    : 'text-muted-foreground mt-0.5 size-3.5 shrink-0'
                                            }
                                            aria-label={issue.severity}
                                        />
                                        <span className="min-w-0">
                                            <span className="text-muted-foreground block truncate font-mono text-[11px]">
                                                {issue.file}
                                                {issue.id ? `#${issue.id}` : ''}
                                            </span>
                                            {issue.message}
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </DialogContent>
        </Dialog>
    );
}
