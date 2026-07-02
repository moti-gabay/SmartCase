import { TasksView } from "@/components/tasks/tasks-view";
import { getTasks, getAgents, getCaseOptions } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const [tasks, agents, cases] = await Promise.all([getTasks(), getAgents(), getCaseOptions()]);
  return <TasksView tasks={tasks} agents={agents} cases={cases} />;
}
