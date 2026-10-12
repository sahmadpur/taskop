/** `/tasks?task=<id>`: the drawer to open (links from rows, the problems page, the execution tab and the create dialog). */
export interface TasksSearch {
  task?: string;
}

export const tasksSearch = (s: Record<string, unknown>): TasksSearch => (typeof s.task === 'string' && s.task ? { task: s.task } : {});
