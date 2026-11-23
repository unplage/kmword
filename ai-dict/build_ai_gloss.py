#!/usr/bin/env python3
"""批量生成单词的 AI 释义（markdown），产出可直接导入 PWA 的 JSONL 缓存文件。

默认使用智谱免费模型（glm-4.7-flash 优先，拥堵时自动降级到 glm-4.5-flash），费用 0。
不使用 opencode 的 agent，直接调用 OpenAI 兼容 API（输入 token 更少、更省）。

用法：
    python3 build_ai_gloss.py                      # 默认 zhipu 免费模型，2 并发
    python3 build_ai_gloss.py --workers 2 --limit 20
    python3 build_ai_gloss.py --backend deepseek   # 其他内置后端
    python3 build_ai_gloss.py --models glm-4.7-flash,glm-4.5-flash

随时停止 / 恢复（已生成的释义不会丢失）：
    停止：touch ai_gloss.stop  （跑完手头的词后优雅退出）
    或者：Ctrl+C / kill <pid>
    恢复：再次运行本脚本（自动清除 stop 标记，跳过已完成的词）

输出：ai_gloss_toefl.jsonl  每行 {"word","content","model","cachedAt"}
日志：ai_gloss.log           失败：ai_gloss_failed.jsonl（下次启动自动重试）
"""

import argparse
import json
import os
import queue
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
AUTH_FILE = os.path.expanduser("~/.local/share/opencode/auth.json")
DEFAULT_INPUT = os.path.join(HERE, "words_toefl.txt")
DEFAULT_OUTPUT = os.path.join(HERE, "ai_gloss_toefl.jsonl")
FAILED_OUTPUT = os.path.join(HERE, "ai_gloss_failed.jsonl")
STOP_FILE = os.path.join(HERE, "ai_gloss.stop")
SCRATCH_DIR = "/tmp/opencode/gloss-agent"

PROMPT = (
    '请分析英文单词 "{word}"，使用中文回答以下内容：\n'
    "1. 词性和基本释义\n"
    "2. 词根词缀分析\n"
    "3. 记忆技巧\n"
    "4. 常用搭配和短语\n"
    "5. 近义词辨析\n"
    "6. 例句\n"
    "7. 对学习这个单词，你有什么好的建议"
)

CONCISE_SUFFIX = "\n\n要求：每个部分简明扼要，全文控制在600字以内，不要省略任何部分。"

BACKENDS = {
    # 智谱免费 flash：glm-4.7-flash 拥堵时自动降级到 glm-4.5-flash
    "zhipu": {
        "base_url": "https://open.bigmodel.cn/api/paas/v4",
        "auth_provider": "zhipuai",
        "models": ["glm-4.7-flash", "glm-4.5-flash"],
        "extra_body": {},
    },
    "deepseek": {
        "base_url": "https://api.deepseek.com",
        "auth_provider": "deepseek",
        "models": ["deepseek-flash"],
        "extra_body": {"thinking": {"type": "disabled"}},
    },
    "mimo": {
        "base_url": "https://api.xiaomimimo.com/v1",
        "auth_provider": "xiaomi",
        "models": ["mimo-v2.6-flash"],
        "extra_body": {"thinking": {"type": "disabled"}},
    },
    "openrouter": {
        "base_url": "https://openrouter.ai/api/v1",
        "auth_provider": "openrouter",
        "models": ["nvidia/nemotron-3.5-super-vl:free"],
        "extra_body": {},
    },
    "opencode": {
        "base_url": None,
        "auth_provider": None,
        "models": ["mimo-v2.6-flash-free"],
        "extra_body": {},
    },
}

MAX_ATTEMPTS = 8
REQUEST_TIMEOUT = 600
MIN_CONTENT = 100
BUSY_COOLDOWN = 600  # 模型繁忙(1305)后暂停使用的秒数

_stop_event = threading.Event()
_write_lock = threading.Lock()
_stat_lock = threading.Lock()
_stats = {"done": 0, "failed": 0, "start": time.time()}

_model_lock = threading.Lock()
_model_blocked_until = {}


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def load_words(path):
    words, seen = [], set()
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            w = line.strip().lower()
            if not w or w.startswith("#") or w in seen:
                continue
            seen.add(w)
            words.append(w)
    return words


def load_done(path):
    done, valid = set(), []
    if not os.path.exists(path):
        return done
    with open(path, encoding="utf-8") as fh:
        raw = fh.read()
    lines = raw.split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    repaired = False
    for i, line in enumerate(lines):
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            if i == len(lines) - 1:
                repaired = True
                continue
            continue
        if isinstance(rec, dict) and rec.get("word") and rec.get("content"):
            done.add(str(rec["word"]).strip().lower())
            valid.append(line)
    if repaired:
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.write("\n".join(valid) + "\n")
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
        log(f"修复了上次中断造成的残缺尾行 -> {os.path.basename(path)}")
    return done


def append_record(path, record):
    line = json.dumps(record, ensure_ascii=False)
    with _write_lock:
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")
            fh.flush()
            os.fsync(fh.fileno())


def http_json(url, data=None, timeout=REQUEST_TIMEOUT, method=None, headers=None):
    body = None if data is None else json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode()
    return json.loads(raw) if raw.strip() else {}


def load_api_key(provider):
    if not provider:
        return None
    with open(AUTH_FILE, encoding="utf-8") as fh:
        auth = json.load(fh)
    entry = auth.get(provider) or {}
    return entry.get("key")


class ApiGenerator:
    """OpenAI 兼容接口，多模型轮换 + 繁忙模型自动冷却。"""

    def __init__(self, base_url, api_key, models, extra_body=None, prompt=PROMPT):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.models = list(models)
        self.extra_body = dict(extra_body or {})
        self.prompt = prompt

    def _pick_model(self):
        now = time.monotonic()
        with _model_lock:
            for m in self.models:
                if _model_blocked_until.get(m, 0) <= now:
                    return m
        return None

    def _block_model(self, model, reason):
        with _model_lock:
            _model_blocked_until[model] = time.monotonic() + BUSY_COOLDOWN
        log(f"模型 {model} 暂不可用（{reason}），冷却 {BUSY_COOLDOWN // 60} 分钟，切换到备用模型")

    def _request(self, model, word):
        text = self.prompt.format(word=word)
        body = {
            "model": model,
            "messages": [{"role": "user", "content": text}],
            "temperature": 0.7,
        }
        body.update(self.extra_body)
        data = http_json(
            self.base_url + "/chat/completions",
            body,
            headers={"Authorization": "Bearer " + self.api_key},
        )
        choices = data.get("choices") or []
        if not choices:
            return None, "响应无 choices"
        content = (choices[0].get("message") or {}).get("content") or ""
        return content.strip(), None

    def generate(self, word):
        """返回 (content, model, err)。"""
        last_err = None
        for attempt in range(1, MAX_ATTEMPTS + 1):
            if _stop_event.is_set():
                return None, None, "stopped"
            model = self._pick_model()
            if not model:
                if attempt == 1:
                    log("所有模型都在冷却中，等待...")
                time.sleep(min(30, 5 * attempt))
                last_err = "所有模型均在冷却"
                continue
            try:
                content, err = self._request(model, word)
            except urllib.error.HTTPError as e:
                try:
                    detail = json.loads(e.read().decode())
                    code = str((detail.get("error") or {}).get("code", ""))
                    msg = (detail.get("error") or {}).get("message", "")
                except Exception:
                    code, msg = str(e.code), ""
                last_err = f"HTTP {e.code} {code} {msg}".strip()
                if e.code == 429 or code in ("1302", "1305"):
                    if code == "1305" or "访问量过大" in msg:
                        self._block_model(model, "访问量过大")
                    time.sleep(min(30, 5 * attempt))
                else:
                    time.sleep(min(30, 3 * attempt))
                continue
            except Exception as e:
                last_err = f"{type(e).__name__}: {e}"
                time.sleep(min(30, 3 * attempt))
                continue

            if content and len(content) >= MIN_CONTENT:
                return content, model, None
            last_err = f"内容过短({len(content) if content else 0}字)"
            time.sleep(min(30, 3 * attempt))
        return None, None, last_err


class OpenCodeGenerator:
    """可选后端：通过 opencode serve 调用免费模型。"""

    def __init__(self, provider, model, prompt=PROMPT):
        self.provider = provider
        self.model = model
        self.prompt = prompt
        self.port = self._free_port()
        self.base = f"http://127.0.0.1:{self.port}"
        self.proc = None

    @staticmethod
    def _free_port():
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            return s.getsockname()[1]

    def start(self):
        os.makedirs(SCRATCH_DIR, exist_ok=True)
        self.proc = subprocess.Popen(
            ["opencode", "serve", "--port", str(self.port)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            cwd=SCRATCH_DIR,
        )
        deadline = time.time() + 90
        while time.time() < deadline:
            if self.proc.poll() is not None:
                raise RuntimeError("opencode serve 启动失败")
            try:
                http_json(self.base + "/doc", timeout=3)
                log(f"opencode serve 已就绪: {self.base} (pid {self.proc.pid})")
                return
            except Exception:
                time.sleep(1)
        raise RuntimeError("opencode serve 启动超时")

    def generate(self, word):
        sid = None
        last_err = None
        for attempt in range(1, MAX_ATTEMPTS + 1):
            if _stop_event.is_set():
                return None, None, "stopped"
            try:
                sess = http_json(self.base + "/session", {"title": word}, timeout=60)
                sid = sess.get("id")
                msg = http_json(
                    f"{self.base}/session/{sid}/message",
                    {
                        "model": {"providerID": self.provider, "modelID": self.model},
                        "parts": [{"type": "text", "text": self.prompt.format(word=word)}],
                    },
                )
                content = "".join(
                    p.get("text", "") for p in (msg.get("parts") or []) if p.get("type") == "text"
                ).strip()
                if content and len(content) >= MIN_CONTENT:
                    return content, self.model, None
                last_err = f"内容过短({len(content)}字)"
            except Exception as e:
                last_err = f"{type(e).__name__}: {e}"
            finally:
                if sid:
                    try:
                        http_json(f"{self.base}/session/{sid}", method="DELETE", timeout=30)
                    except Exception:
                        pass
            time.sleep(min(30, 3 * attempt))
        return None, None, last_err

    def close(self):
        if not self.proc:
            return
        self.proc.terminate()
        try:
            self.proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            self.proc.wait(timeout=5)
        log("opencode serve 已停止")


def worker(generator, job_queue, output, limit_reached):
    while not _stop_event.is_set() and not limit_reached.is_set():
        if os.path.exists(STOP_FILE):
            _stop_event.set()
            break
        try:
            word = job_queue.get_nowait()
        except queue.Empty:
            break

        content, model, err = generator.generate(word)
        if _stop_event.is_set() and not content:
            job_queue.put(word)
            job_queue.task_done()
            break

        if content:
            rec = {
                "word": word,
                "content": content,
                "model": model,
                "cachedAt": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
            }
            append_record(output, rec)
            with _stat_lock:
                _stats["done"] += 1
                done = _stats["done"]
                elapsed = time.time() - _stats["start"]
                rate = done / elapsed if elapsed else 0
                remaining = job_queue.qsize()
                eta = remaining / rate if rate else 0
                if done % 10 == 0:
                    log(
                        f"进度 {done} 完成 / 失败 {_stats['failed']} / 剩余 {remaining} | "
                        f"{rate:.2f} 词/秒 | 预计还需 {eta / 3600:.1f} 小时 | 模型 {model}"
                    )
            if done_limit and done >= done_limit:
                limit_reached.set()
        else:
            with _stat_lock:
                _stats["failed"] += 1
            append_record(
                FAILED_OUTPUT, {"word": word, "error": err, "attempts": MAX_ATTEMPTS}
            )
            with _stat_lock:
                if _stats["failed"] <= 20 or _stats["failed"] % 25 == 0:
                    log(f"失败[{_stats['failed']}] {word}: {err} (下次启动会重试)")
        job_queue.task_done()


done_limit = None
limit_reached = threading.Event()


def handle_signal(signum, frame):
    log(f"收到信号 {signum}，停止接收新词（等待手头的词写完）...")
    _stop_event.set()


def main():
    global done_limit
    ap = argparse.ArgumentParser(description="批量生成 AI 释义")
    ap.add_argument("--backend", default="zhipu", choices=sorted(BACKENDS.keys()))
    ap.add_argument("--models", default="", help="逗号分隔，覆盖后端默认模型列表")
    ap.add_argument("--input", default=DEFAULT_INPUT, help="单词表（每行一个）")
    ap.add_argument("--output", default=DEFAULT_OUTPUT, help="输出 JSONL")
    ap.add_argument("--workers", type=int, default=2, help="并发数（默认 2）")
    ap.add_argument("--limit", type=int, default=0, help="本次最多新生成 N 个词")
    ap.add_argument("--concise", action="store_true", help="追加“全文600字以内”要求，减少输出 token")
    ap.add_argument("--clear-stop", action="store_true", help="仅清除停止标记")
    args = ap.parse_args()

    if args.clear_stop:
        if os.path.exists(STOP_FILE):
            os.remove(STOP_FILE)
            log("已清除停止标记")
        else:
            log("没有停止标记")
        return 0

    if os.path.exists(STOP_FILE):
        os.remove(STOP_FILE)
        log("检测到停止标记，已清除（开始/继续生成）")

    words = load_words(args.input)
    done = load_done(args.output)
    pending = [w for w in words if w not in done]
    log(f"词表 {len(words)} 词，已完成 {len(done)}，本次待生成 {len(pending)}")
    if not pending:
        log("没有待生成的词，退出")
        return 0

    done_limit = args.limit or 0
    if done_limit:
        pending = pending[:done_limit]
        log(f"--limit 生效：本次只生成 {len(pending)} 个")

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    spec = BACKENDS[args.backend]
    models = [m.strip() for m in args.models.split(",") if m.strip()] or spec["models"]
    prompt = PROMPT + (CONCISE_SUFFIX if args.concise else "")

    generator = None
    try:
        if args.backend == "opencode":
            generator = OpenCodeGenerator("opencode", models[0], prompt)
            generator.start()
        else:
            key = load_api_key(spec["auth_provider"])
            if not key:
                log(f"未找到 {spec['auth_provider']} 的 API key（{AUTH_FILE}）")
                return 1
            generator = ApiGenerator(spec["base_url"], key, models, spec["extra_body"], prompt)
            log(f"后端 {args.backend}，模型 {', '.join(models)}")

        jobs = queue.Queue()
        for w in pending:
            jobs.put(w)

        log(f"启动 {args.workers} 个并发 worker")
        threads = [
            threading.Thread(
                target=worker, args=(generator, jobs, args.output, limit_reached), daemon=True
            )
            for _ in range(args.workers)
        ]
        t0 = time.time()
        for t in threads:
            t.start()
        while any(t.is_alive() for t in threads):
            time.sleep(2)
        _stop_event.set()
        for t in threads:
            t.join(timeout=900)

        elapsed = time.time() - t0
        log(
            f"本次结束：新生成 {_stats['done']}，失败 {_stats['failed']}，"
            f"耗时 {elapsed / 60:.1f} 分钟"
        )
    finally:
        if isinstance(generator, OpenCodeGenerator):
            generator.close()
        if os.path.exists(STOP_FILE):
            os.remove(STOP_FILE)
            log("停止标记已清除，可直接再次运行以继续")
    return 0


if __name__ == "__main__":
    sys.exit(main())
