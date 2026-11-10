import { TaskChooseOrganization } from "@clerk/nextjs";

// Public in proxy.ts: a pending session is not "signed in" to the server, so protecting this route
// would redirect the very users who need it.
export default function ChooseOrganization() {
  return (
    <div className="shell">
      <TaskChooseOrganization redirectUrlComplete="/app" />
    </div>
  );
}
