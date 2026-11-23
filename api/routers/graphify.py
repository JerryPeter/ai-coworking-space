"""Graphify knowledge-graph page: read-only graph.json/GRAPH_REPORT.md + a single-flight update job.

Every route here sits under /api/graphify/* and inherits bearer-token auth from the top-level
router in api/main.py — including POST /update (CTO decision #2 in the Graphify brief: no
unauthenticated endpoint is added for graph.html either; it is fetched with a bearer token and
opened client-side as a Blob URL).
"""
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from api.routers._common import JobId
from api.sources import graphify as src

router = APIRouter(prefix="/graphify", tags=["graphify"])


@router.get("/stats")
def get_stats() -> dict:
    try:
        stats = src.graph_stats()
    except src.GraphNotFound as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return {**stats, "source": "graphify-out/graph.json + GRAPH_REPORT.md (parsed once, cached by mtime)"}


@router.get("/top-nodes")
def get_top_nodes(limit: int = Query(10, ge=1, le=50)) -> dict:
    try:
        nodes = src.top_nodes(limit)
    except src.GraphNotFound as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return {"nodes": nodes, "limit": limit, "source": "graphify-out/graph.json (degree = links touching the node id)"}


@router.get("/findings")
def get_findings() -> dict:
    try:
        items = src.findings()
    except src.GraphNotFound as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return {"findings": items, "source": "graphify-out/graph.json + GRAPH_REPORT.md"}


@router.post("/update", status_code=202)
def post_update() -> dict:
    """Starts `graphify update .` in the background (argv list, shell=False, 10-minute timeout,
    one job at a time). 409 with the running job's id if one is already in flight."""
    job, started = src.start_update()
    if not started:
        raise HTTPException(
            status_code=409,
            detail={"message": "graphify update already running", "job_id": job["job_id"]},
        )
    return job


@router.get("/update/{job_id}")
def get_update_job(job_id: str = JobId) -> dict:
    job = src.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown job_id")
    return job


@router.get("/graph.html")
def get_graph_html() -> FileResponse:
    if not src.GRAPH_HTML.is_file():
        raise HTTPException(status_code=404, detail="graph.html not found — run Update Graph first")
    return FileResponse(src.GRAPH_HTML, media_type="text/html")
