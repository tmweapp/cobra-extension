"""
FireScrape Python SDK
Controlla FireScrape da qualsiasi script Python.

Uso:
    from firescrape import FireScrape

    fs = FireScrape()                          # default: localhost:9222
    fs = FireScrape(port=9222, api_key="xxx")  # con autenticazione

    # Scraping
    page = fs.scrape()                         # tab attivo
    pages = fs.batch(["https://a.com", "https://b.com"])
    sitemap = fs.map("https://example.com", max_urls=100)

    # Crawl
    fs.crawl_start("https://example.com", max_pages=50)
    status = fs.crawl_status()
    fs.crawl_stop()

    # Agent
    fs.click("#button")
    fs.type("#input", "testo")
    fs.scroll(50)  # 50% della pagina
    snap = fs.snapshot()
    fs.sequence([
        {"action": "navigate", "url": "https://google.com"},
        {"action": "type", "selector": "textarea", "text": "query"},
        {"action": "click", "selector": "input[type=submit]"},
    ])

    # Brain AI
    analysis = fs.analyze()
    answer = fs.think("Che tipo di azienda è?")
    stats = fs.brain_stats()

    # Screenshot
    img = fs.screenshot()
    img_full = fs.screenshot(full_page=True)

    # Extract strutturato
    data = fs.extract({"title": "h1", "price": ".price", "email": "regex:[\\w.-]+@[\\w.-]+"})
"""

import json
import urllib.request
import urllib.error
from typing import Any


class FireScrapeError(Exception):
    def __init__(self, message, code=None):
        super().__init__(message)
        self.code = code


class FireScrape:
    def __init__(self, host="127.0.0.1", port=9222, api_key=None, timeout=30):
        self.base_url = f"http://{host}:{port}"
        self.api_key = api_key
        self.timeout = timeout

    def _request(self, method, path, data=None):
        url = f"{self.base_url}{path}"
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["X-API-Key"] = self.api_key

        body = json.dumps(data).encode("utf-8") if data else None
        req = urllib.request.Request(url, data=body, headers=headers, method=method)

        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            try:
                err = json.loads(body)
                raise FireScrapeError(err.get("error", str(e)), err.get("code"))
            except (json.JSONDecodeError, FireScrapeError):
                raise
            except Exception:
                raise FireScrapeError(f"HTTP {e.code}: {body}")
        except urllib.error.URLError as e:
            raise FireScrapeError(
                f"Connessione fallita a {self.base_url} — il bridge è attivo? ({e.reason})"
            )

    def _get(self, path):
        return self._request("GET", path)

    def _post(self, path, data=None):
        return self._request("POST", path, data or {})

    # === Health ===
    def health(self):
        return self._get("/api/health")

    def actions(self):
        return self._get("/api/actions")

    # === Scraping ===
    def scrape(self, skip_cache=False):
        return self._post("/api/scrape", {"skipCache": skip_cache})

    def batch(self, urls, concurrency=3):
        return self._post("/api/batch", {"urls": urls, "concurrency": concurrency})

    def map(self, url, max_urls=100):
        return self._post("/api/map", {"url": url, "maxUrls": max_urls})

    def extract(self, schema):
        return self._post("/api/extract", {"schema": schema})

    # === Crawl ===
    def crawl_start(self, url, max_pages=30, max_depth=3, delay=800):
        return self._post("/api/crawl/start", {
            "url": url,
            "config": {"maxPages": max_pages, "maxDepth": max_depth, "delay": delay},
        })

    def crawl_stop(self):
        return self._post("/api/crawl/stop")

    def crawl_status(self):
        return self._get("/api/crawl/status")

    # === Agent ===
    def click(self, selector, **options):
        return self._post("/api/agent/action", {"step": {"action": "click", "selector": selector, "options": options}})

    def type(self, selector, text):
        return self._post("/api/agent/action", {"step": {"action": "type", "selector": selector, "text": text}})

    def scroll(self, target):
        return self._post("/api/agent/action", {"step": {"action": "scroll", "target": target}})

    def read(self, selector, max=50):
        return self._post("/api/agent/action", {"step": {"action": "read", "selector": selector, "options": {"max": max}}})

    def wait(self, selector, timeout=10000):
        return self._post("/api/agent/action", {"step": {"action": "wait", "selector": selector, "timeout": timeout}})

    def select(self, selector, value):
        return self._post("/api/agent/action", {"step": {"action": "select", "selector": selector, "value": value}})

    def form_fill(self, fields):
        return self._post("/api/agent/action", {"step": {"action": "formFill", "fields": fields}})

    def navigate(self, url):
        return self._post("/api/agent/action", {"step": {"action": "navigate", "url": url}})

    def snapshot(self):
        return self._get("/api/agent/snapshot")

    def sequence(self, steps):
        return self._post("/api/agent/sequence", {"steps": steps})

    # === Screenshot ===
    def screenshot(self, full_page=False, format="png", quality=92):
        return self._post("/api/screenshot", {"fullPage": full_page, "format": format, "quality": quality})

    # === Brain ===
    def analyze(self):
        return self._post("/api/brain/analyze")

    def think(self, prompt):
        return self._post("/api/brain/think", {"prompt": prompt})

    def brain_stats(self):
        return self._get("/api/brain/stats")

    def brain_config(self, config):
        return self._post("/api/brain/config", {"config": config})

    # === Library ===
    def library_search(self, query=""):
        return self._get(f"/api/library/search?query={query}")

    def library_export(self):
        return self._get("/api/library/export")

    def library_clear(self):
        return self._post("/api/library/clear")

    # === Relay ===
    def relay_start(self):
        return self._post("/api/relay/start")

    def relay_stop(self):
        return self._post("/api/relay/stop")

    def relay_status(self):
        return self._get("/api/relay/status")

    # === Cache & Rate ===
    def cache_stats(self):
        return self._get("/api/cache/stats")

    def cache_clear(self):
        return self._post("/api/cache/clear")

    def rate_stats(self):
        return self._get("/api/rate/stats")

    # === TaskRunner ===
    def task_create(self, task):
        """Crea un task multi-step autonomo.
        task = { name, description, steps: [{action, params, optional, retries, timeout}], config }
        """
        return self._post("/api/task/create", {"task": task})

    def task_start(self, task_id):
        return self._post("/api/task/start", {"taskId": task_id})

    def task_pause(self, task_id):
        return self._post("/api/task/pause", {"taskId": task_id})

    def task_cancel(self, task_id):
        return self._post("/api/task/cancel", {"taskId": task_id})

    def task_retry(self, task_id):
        return self._post("/api/task/retry", {"taskId": task_id})

    def task_status(self, task_id):
        return self._get(f"/api/task/status?taskId={task_id}")

    def task_list(self, status=None, limit=20):
        params = {"filter": {}}
        if status:
            params["filter"]["status"] = status
        params["filter"]["limit"] = limit
        return self._get(f"/api/task/list")

    def task_stats(self):
        return self._get("/api/task/stats")

    # === FileManager ===
    def download_data(self, data, filename, format="csv", **options):
        """Genera e scarica un file dal browser."""
        return self._post("/api/file/download", {
            "data": data, "filename": filename, "format": format, "options": options
        })

    def file_list(self, **filter_opts):
        return self._get("/api/file/list")

    def file_search(self, query):
        return self._get(f"/api/file/search?query={query}")

    def file_stats(self):
        return self._get("/api/file/stats")

    # === Connectors ===
    def connector_list(self):
        return self._get("/api/connector/list")

    def connector_configure(self, connector_id, config):
        return self._post("/api/connector/config", {"connectorId": connector_id, "config": config})

    def connector_execute(self, connector_id, method, params=None):
        return self._post("/api/connector/exec", {
            "connectorId": connector_id, "method": method, "params": params or {}
        })

    def connector_test(self, connector_id):
        return self._post("/api/connector/test", {"connectorId": connector_id})

    # === Pipeline ===
    def pipeline_save(self, pipeline):
        return self._post("/api/pipeline/save", {"pipeline": pipeline})

    def pipeline_list(self):
        return self._get("/api/pipeline/list")

    def pipeline_execute(self, pipeline_id, variables=None):
        return self._post("/api/pipeline/exec", {"pipelineId": pipeline_id, "variables": variables or {}})

    def pipeline_delete(self, pipeline_id):
        return self._post("/api/pipeline/delete", {"pipelineId": pipeline_id})

    def pipeline_templates(self):
        return self._get("/api/pipeline/templates")

    # === ElevenLabs ===
    def el_config(self):
        return self._get("/api/el/config")

    def el_set_config(self, config):
        return self._post("/api/el/config", {"config": config})

    def el_voices(self, refresh=False):
        return self._get(f"/api/el/voices?refresh={'true' if refresh else 'false'}")

    def el_voice_search(self, query):
        return self._post("/api/el/voice/search", {"query": query})

    def el_voice_preview(self, voice_id):
        return self._post("/api/el/voice/preview", {"voiceId": voice_id})

    def el_models(self):
        return self._get("/api/el/models")

    def el_speak(self, text, **options):
        return self._post("/api/el/speak", {"text": text, "options": options})

    def el_speak_page(self, **options):
        return self._post("/api/el/speak-page", {"options": options})

    def el_agents(self):
        return self._get("/api/el/agents")

    def el_create_agent(self, agent):
        return self._post("/api/el/agent/create", {"agent": agent})

    def el_delete_agent(self, agent_id):
        return self._post("/api/el/agent/delete", {"agentId": agent_id})

    def el_stats(self):
        return self._get("/api/el/stats")

    def el_history(self, page_size=100):
        return self._get(f"/api/el/history?pageSize={page_size}")

    def el_languages(self):
        return self._get("/api/el/languages")

    # === Workflow shortcut ===
    def run_workflow(self, name, steps, on_error="stop"):
        """Shortcut: crea ed esegui un workflow in un solo comando.

        Esempio:
            fs.run_workflow("scrape aziende", [
                {"action": "navigate", "params": {"url": "https://example.com"}},
                {"action": "scrape", "params": {}},
                {"action": "brain-think", "params": {"prompt": "Estrai contatti"}},
                {"action": "download", "params": {"format": "csv", "filename": "contacts.csv"}},
            ])
        """
        task = {
            "name": name,
            "steps": steps,
            "config": {"onError": on_error}
        }
        result = self.task_create(task)
        task_id = result.get("id") or result.get("taskId")
        if task_id:
            self.task_start(task_id)
        return {"taskId": task_id, **result}


# Uso standalone: python firescrape.py
if __name__ == "__main__":
    import sys

    fs = FireScrape()
    try:
        h = fs.health()
        print(f"FireScrape Bridge OK — v{h['version']}, uptime: {h['uptime']:.0f}s")
        print(f"\nAzioni disponibili:")
        for a in fs.actions()["actions"]:
            print(f"  {a}")
    except FireScrapeError as e:
        print(f"Errore: {e}", file=sys.stderr)
        sys.exit(1)
