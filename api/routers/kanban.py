from fastapi import APIRouter

from api.sources import kanban

router = APIRouter(prefix="/kanban", tags=["kanban"])


@router.get("/tasks")
def list_tasks() -> dict:
    d = kanban.tasks()
    return {
        "count": d["total"],
        "returned": len(d["tasks"]) if d["tasks"] is not None else None,
        "truncated": d["truncated"],
        "columns": [{"status": c["status"], "label": c["label"], "count": c["count"], "tasks": c["tasks"]}
                    for c in d["columns"]] if d["columns"] is not None else None,
        "available": d["available"],
        "error": d["error"],
        "source": "~/.hermes/kanban.db: tasks (columns = Hermes DEFAULT_WORKFLOW + archived)",
    }
