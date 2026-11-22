// Workflow view: placeholder until the functional scope is decided (t_b9f7d656).
import { Workflow } from "lucide-react";
import { EmptyState } from "../components/ui/States";

export default function WorkflowView() {
  return (
    <div className="card">
      <EmptyState icon={<Workflow size={48} />} title="Workflow" body="Halaman ini sedang disiapkan." />
    </div>
  );
}
