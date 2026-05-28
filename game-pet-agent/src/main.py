import base64
import ctypes
import io
import json
import os
import threading
import time
import traceback
import tkinter as tk
from dataclasses import dataclass
from datetime import datetime
from tkinter import messagebox, scrolledtext

import pyautogui
import requests
from PIL import Image, ImageGrab
from pynput import keyboard


API_BASE_URL = "https://api.siliconflow.cn/v1/chat/completions"
API_CONNECT_TIMEOUT = 15
API_READ_TIMEOUT = 180
API_RETRY_COUNT = 2
API_RETRY_BACKOFF_SEC = 3.0
MAX_SCREENSHOT_LONG_EDGE = 1280
DEFAULT_MODEL = "deepseek-ai/deepseek-vl2"
DEFAULT_INTERVAL = 180.0
MIN_INTERVAL = 30.0
MAX_INTERVAL = 600.0
DEFAULT_MAX_STEPS = 200
DEFAULT_HOTKEY = "<ctrl>+<alt>+s"

SETUP_GEOMETRY = "760x720"
COMPACT_GEOMETRY = "620x88"
COMPACT_WITH_ERROR_GEOMETRY = "620x200"

ACTION_WAIT = "wait"
ACTION_CLICK = "click"
ACTION_KEY = "key"
ACTION_TYPE = "type"
ACTION_STOP = "stop"

ALLOWED_ACTIONS = {ACTION_WAIT, ACTION_CLICK, ACTION_KEY, ACTION_TYPE, ACTION_STOP}
MAX_SUBSTEPS_PER_RESPONSE = 12
MAX_THINKING_ITEMS = 16
SUBSTEP_DELAY_SEC = 0.35
THINKING_PHASES = frozenset({"observe", "analyze", "plan", "confirm", "note"})

DEFAULT_SYSTEM_PROMPT = """你是 RPG 游戏自动化测试代理（Game Pet Agent）。你会收到当前屏幕截图与用户任务，需要像测试员一样观察、推理，并输出结构化 JSON。

【角色与目标】
- 模仿玩家完成游戏测试：推进对话、确认菜单、完成当前任务步骤。
- 优先选择稳妥、可解释的操作；看不清或不确定时不要猜测坐标。
- 界面未加载完成、动画播放中、无法判断下一步时，使用 wait 等待。

【输出格式（必须严格遵守）】
- 只输出一个合法 JSON 对象。禁止 Markdown、代码块、前后说明文字。
- 必须包含 thinking（思考过程，程序不会执行）与 final（最终决策与可执行步骤）。

JSON 结构：
{
  "thinking": [
    {"phase": "observe", "content": "描述截图中看到的关键 UI、文字、状态"},
    {"phase": "analyze", "content": "分析当前目标、障碍与风险"},
    {"phase": "plan", "content": "用文字说明本回合打算做的操作顺序"},
    {"phase": "confirm", "content": "确认 final.steps 与上述计划一致"}
  ],
  "final": {
    "summary": "本回合最终决策（一句话）",
    "steps": [
      {"action": "click", "x": 0, "y": 0},
      {"action": "wait", "duration": 0.5},
      {"action": "type", "text": ""},
      {"action": "key", "key": "enter"}
    ]
  }
}

【thinking 规则（过程，不执行）】
- phase 仅允许：observe | analyze | plan | confirm | note
- observe：客观描述画面元素（按钮、对话框、菜单、任务提示等）
- analyze：推理当前处于什么流程、下一步目标是什么
- plan：说明准备如何操作（文字描述即可）
- confirm：核对即将执行的 steps 是否合理
- thinking 中禁止出现 action、x、y、key、text 等执行字段

【final 规则（最终决定，会执行）】
- final.summary：一句话概括本回合要做什么
- final.steps：本回合按顺序执行的操作数组（最多 12 步）
- 每步字段：action（必填）、x、y、key、text、duration（按需）
- action 仅允许：wait | click | key | type | stop
  - click：点击屏幕像素坐标，x 和 y 必填
  - key：按键，如 enter、esc、space、tab
  - type：输入文本（建议英文/数字），text 必填
  - wait：等待界面刷新，duration 建议 0.3~1.5 秒
  - stop：请求停止代理
- 坐标基于当前截图对应的屏幕像素（左上角为原点）
- 典型多步流程写在同一 steps 中，例如：点按钮 → 点对话框 → 输入 → 回车
- 若步骤间界面可能变化，在 steps 末尾增加 wait，留给下一轮重新截图后再决策

【决策原则】
- 一次返回能完成的连贯操作尽量放在同一 final.steps，减少来回猜测
- 不要点击看不清或遮挡的位置
- 不要执行与任务无关的操作（如关闭游戏、退出到桌面）
- 连续失败或画面无变化时，优先 wait；仍无法推进可 stop

【陪伴模式（可选）】
- 若用户任务改为「陪伴玩家的宠物」，thinking 可加入对玩家状态的关心，但 final.steps 仍只包含测试所需操作，不要闲聊式输出。"""

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
LOG_DIR = os.path.join(PROJECT_ROOT, "logs")


@dataclass
class AgentAction:
    action: str = ACTION_WAIT
    x: int | None = None
    y: int | None = None
    key: str | None = None
    text: str | None = None
    duration: float = 0.2
    reason: str = ""


@dataclass
class ThinkingStep:
    phase: str
    content: str
    index: int = 0


@dataclass
class AgentPlan:
    thinking: list[ThinkingStep]
    steps: list[AgentAction]
    decision_summary: str = ""
    reason: str = ""


class SessionLogger:
    def __init__(self, ui_append, overlay_show) -> None:
        os.makedirs(LOG_DIR, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.file_path = os.path.join(LOG_DIR, f"session_{stamp}.log")
        self._ui_append = ui_append
        self._overlay_show = overlay_show
        self._lock = threading.Lock()
        self._write_file("INFO", "日志会话开始", {"path": self.file_path})

    def _write_file(self, level: str, message: str, extra: dict | None = None) -> None:
        line = f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] [{level}] {message}"
        if extra:
            try:
                line += "\n" + json.dumps(extra, ensure_ascii=False, indent=2)
            except Exception:
                line += f"\n{extra}"
        line += "\n"
        with self._lock:
            with open(self.file_path, "a", encoding="utf-8") as f:
                f.write(line)

    def info(self, message: str, extra: dict | None = None) -> None:
        self._write_file("INFO", message, extra)
        self._ui_append("INFO", message)

    def ai_io(self, direction: str, payload: dict) -> None:
        self._write_file("AI", f"{direction}", payload)
        summary = payload.get("summary") or direction
        self._ui_append("AI", summary)

    def think(self, message: str, extra: dict | None = None) -> None:
        self._write_file("THINK", message, extra)
        self._ui_append("THINK", message)

    def exec_plan(self, message: str, extra: dict | None = None) -> None:
        self._write_file("EXEC", message, extra)
        self._ui_append("EXEC", message)

    def warn(self, message: str, extra: dict | None = None) -> None:
        self._write_file("WARN", message, extra)
        self._ui_append("WARN", message)

    def error(self, message: str, detail: str = "", extra: dict | None = None) -> None:
        full = message
        if detail:
            full = f"{message}\n{detail}"
        self._write_file("ERROR", message, extra or {"detail": detail})
        self._ui_append("ERROR", full)
        self._overlay_show(message, detail)


def format_exception(err: BaseException) -> str:
    lines = [f"{type(err).__name__}: {err}"]
    if isinstance(err, requests.HTTPError) and err.response is not None:
        resp = err.response
        lines.append(f"HTTP 状态码: {resp.status_code}")
        try:
            body = resp.text.strip()
            if body:
                lines.append(f"响应内容: {body[:1200]}")
        except Exception:
            pass
    elif isinstance(err, requests.ReadTimeout):
        lines.append(
            "API 在限定时间内未返回（视觉模型较慢时常见）。"
            "已自动重试；若仍失败可换更快模型或增大 API_READ_TIMEOUT。"
        )
    elif isinstance(err, requests.RequestException):
        lines.append("网络请求失败，请检查网络、API Key、模型名是否正确。")
    tb = traceback.format_exc()
    if tb and tb.strip() != "NoneType: None":
        lines.append("--- 堆栈 ---")
        lines.append(tb.strip())
    return "\n".join(lines)


class SiliconFlowGamePetDemo:
    def __init__(self) -> None:
        pyautogui.FAILSAFE = True
        pyautogui.PAUSE = 0.1

        self.root = tk.Tk()
        self.root.title("Game Pet Agent")
        self.root.geometry(SETUP_GEOMETRY)
        self.root.minsize(480, 400)

        self.running_event = threading.Event()
        self.worker_thread: threading.Thread | None = None
        self.hotkey_listener: keyboard.Listener | None = None
        self.hotkey_handler: keyboard.HotKey | None = None
        self.started_at: float | None = None
        self.step_count = 0
        self.session_logger: SessionLogger | None = None
        self.log_window: tk.Toplevel | None = None
        self.log_text_widget: scrolledtext.ScrolledText | None = None
        self.ui_mode = "setup"
        self._saved_setup_geometry = SETUP_GEOMETRY

        self._build_setup_ui()
        self._build_compact_ui()
        self._init_global_hotkey()
        self._show_setup_mode()
        self._tick_runtime_clock()

    def _build_setup_ui(self) -> None:
        self.setup_frame = tk.Frame(self.root)
        self.setup_frame.pack(fill="both", expand=True)

        top_frame = tk.Frame(self.setup_frame, padx=12, pady=10)
        top_frame.pack(fill="x")

        tk.Label(top_frame, text="硅基流动 API Key").grid(row=0, column=0, sticky="w")
        self.api_key_var = tk.StringVar()
        tk.Entry(top_frame, textvariable=self.api_key_var, show="*", width=58).grid(
            row=0, column=1, sticky="we", padx=8
        )

        tk.Label(top_frame, text="模型").grid(row=1, column=0, sticky="w", pady=(8, 0))
        self.model_var = tk.StringVar(value=DEFAULT_MODEL)
        tk.Entry(top_frame, textvariable=self.model_var, width=58).grid(
            row=1, column=1, sticky="we", padx=8, pady=(8, 0)
        )

        tk.Label(top_frame, text="循环间隔(秒，180=3分钟)").grid(row=2, column=0, sticky="w", pady=(8, 0))
        self.interval_var = tk.StringVar(value=str(int(DEFAULT_INTERVAL)))
        tk.Entry(top_frame, textvariable=self.interval_var, width=20).grid(
            row=2, column=1, sticky="w", padx=8, pady=(8, 0)
        )

        tk.Label(top_frame, text="最大步数").grid(row=3, column=0, sticky="w", pady=(8, 0))
        self.max_steps_var = tk.StringVar(value=str(DEFAULT_MAX_STEPS))
        tk.Entry(top_frame, textvariable=self.max_steps_var, width=20).grid(
            row=3, column=1, sticky="w", padx=8, pady=(8, 0)
        )

        tk.Label(top_frame, text="全局急停热键").grid(row=4, column=0, sticky="w", pady=(8, 0))
        self.hotkey_var = tk.StringVar(value=DEFAULT_HOTKEY)
        tk.Entry(top_frame, textvariable=self.hotkey_var, width=20).grid(
            row=4, column=1, sticky="w", padx=8, pady=(8, 0)
        )

        tk.Label(top_frame, text="目标窗口关键词").grid(row=5, column=0, sticky="w", pady=(8, 0))
        self.target_window_var = tk.StringVar(value="")
        tk.Entry(top_frame, textvariable=self.target_window_var, width=40).grid(
            row=5, column=1, sticky="w", padx=8, pady=(8, 0)
        )
        tk.Button(top_frame, text="读取当前窗口", command=self.capture_current_window_title).grid(
            row=5, column=1, sticky="e", padx=8, pady=(8, 0)
        )

        self.require_focus_var = tk.BooleanVar(value=True)
        tk.Checkbutton(
            top_frame,
            text="仅在目标窗口激活时执行输入",
            variable=self.require_focus_var,
        ).grid(row=6, column=1, sticky="w", padx=8, pady=(6, 0))
        top_frame.columnconfigure(1, weight=1)

        prompt_frame = tk.LabelFrame(self.setup_frame, text="系统 Prompt", padx=10, pady=8)
        prompt_frame.pack(fill="x", padx=12, pady=(0, 8))
        prompt_btn_row = tk.Frame(prompt_frame)
        prompt_btn_row.pack(fill="x", pady=(0, 4))
        tk.Button(prompt_btn_row, text="恢复标准 System Prompt", command=self._reset_standard_system_prompt).pack(
            side="right"
        )

        self.system_prompt_text = scrolledtext.ScrolledText(prompt_frame, height=14, wrap="word")
        self.system_prompt_text.pack(fill="x")
        self.system_prompt_text.insert("1.0", DEFAULT_SYSTEM_PROMPT)

        task_frame = tk.LabelFrame(self.setup_frame, text="当前任务", padx=10, pady=8)
        task_frame.pack(fill="x", padx=12, pady=(0, 8))
        self.task_prompt_text = scrolledtext.ScrolledText(task_frame, height=3, wrap="word")
        self.task_prompt_text.pack(fill="x")
        self.task_prompt_text.insert("1.0", "你现在是模仿玩家，完成这个游戏测试。")

        btn_row = tk.Frame(self.setup_frame, padx=12, pady=8)
        btn_row.pack(fill="x")
        self.setup_start_btn = tk.Button(btn_row, text="开始运行", width=14, command=self.start_agent)
        self.setup_start_btn.pack(side="left")
        tk.Button(btn_row, text="打开日志窗口", width=12, command=self._ensure_log_window).pack(side="left", padx=8)
        tk.Label(btn_row, text="开始后主窗口会收成一行控制条", fg="#666").pack(side="left", padx=8)

        self.root.bind("<Escape>", lambda _e: self.emergency_stop())
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

    def _build_compact_ui(self) -> None:
        self.compact_root = tk.Frame(self.root)

        bar = tk.Frame(self.compact_root, padx=8, pady=6, bg="#2c3e50")
        bar.pack(fill="x")

        self.compact_status_dot = tk.Canvas(bar, width=14, height=14, highlightthickness=0, bg="#2c3e50")
        self.compact_status_dot.pack(side="left", padx=(4, 6))

        self.compact_status_var = tk.StringVar(value="已停止")
        tk.Label(bar, textvariable=self.compact_status_var, fg="white", bg="#2c3e50", width=10).pack(
            side="left"
        )

        self.compact_runtime_var = tk.StringVar(value="00:00")
        tk.Label(bar, textvariable=self.compact_runtime_var, fg="#bdc3c7", bg="#2c3e50", width=6).pack(
            side="left", padx=(4, 8)
        )

        self.compact_last_var = tk.StringVar(value="—")
        tk.Label(bar, textvariable=self.compact_last_var, fg="#ecf0f1", bg="#2c3e50", anchor="w").pack(
            side="left", fill="x", expand=True
        )

        self.compact_start_btn = tk.Button(bar, text="开始", width=6, command=self.start_agent, bg="#27ae60", fg="white")
        self.compact_start_btn.pack(side="right", padx=2)

        self.compact_pause_btn = tk.Button(
            bar, text="暂停", width=6, command=self.stop_agent, state="disabled", bg="#c0392b", fg="white"
        )
        self.compact_pause_btn.pack(side="right", padx=2)

        self.compact_close_btn = tk.Button(
            bar,
            text="关闭",
            width=6,
            command=self._close_compact_return_setup,
            state="disabled",
            bg="#34495e",
            fg="white",
        )
        self.compact_close_btn.pack(side="right", padx=2)

        tk.Button(bar, text="日志", width=5, command=self._ensure_log_window, bg="#34495e", fg="white").pack(
            side="right", padx=2
        )

        self.error_overlay = tk.Frame(self.compact_root, bg="#1a1a1a", padx=10, pady=8)
        self.error_overlay_visible = False

        err_header = tk.Frame(self.error_overlay, bg="#1a1a1a")
        err_header.pack(fill="x")
        tk.Label(err_header, text="运行异常", fg="#e74c3c", bg="#1a1a1a", font=("", 10, "bold")).pack(side="left")
        tk.Button(
            err_header,
            text="关闭",
            command=self._hide_error_overlay,
            bg="#333",
            fg="white",
            relief="flat",
            padx=8,
        ).pack(side="right")

        self.error_text = tk.Text(
            self.error_overlay,
            height=5,
            wrap="word",
            bg="#1a1a1a",
            fg="#f5f5f5",
            insertbackground="white",
            relief="flat",
            font=("Consolas", 9),
        )
        self.error_text.pack(fill="both", expand=True, pady=(6, 0))
        self.error_text.configure(state="disabled")

        try:
            self.root.attributes("-alpha", 0.97)
        except tk.TclError:
            pass

    def _show_setup_mode(self) -> None:
        if self.running_event.is_set():
            messagebox.showwarning("无法切换", "代理运行中不能打开设置。请先点「暂停」，再点「关闭」返回设置。")
            return
        self.ui_mode = "setup"
        self.compact_root.pack_forget()
        self.setup_frame.pack(fill="both", expand=True)
        if self._saved_setup_geometry:
            self.root.geometry(self._saved_setup_geometry)
        self.root.minsize(480, 400)
        self._hide_error_overlay()
        self.compact_close_btn.config(state="disabled")

    def _close_compact_return_setup(self) -> None:
        if self.running_event.is_set():
            messagebox.showwarning("无法关闭", "请先暂停代理，再返回设置界面。")
            return
        self._show_setup_mode()

    def _show_compact_mode(self) -> None:
        self.ui_mode = "compact"
        try:
            self._saved_setup_geometry = self.root.geometry()
        except Exception:
            pass
        self.setup_frame.pack_forget()
        self.compact_root.pack(fill="both", expand=True)
        self.root.minsize(400, 48)
        if self.error_overlay_visible:
            self.root.geometry(COMPACT_WITH_ERROR_GEOMETRY)
        else:
            self.root.geometry(COMPACT_GEOMETRY)

    def _ensure_log_window(self) -> None:
        if self.log_window and self.log_window.winfo_exists():
            self.log_window.lift()
            self.log_window.focus_force()
            return

        self.log_window = tk.Toplevel(self.root)
        self.log_window.title("Game Pet — 运行日志")
        self.log_window.geometry("720x480")
        self.log_window.minsize(400, 200)

        header = tk.Frame(self.log_window, padx=8, pady=6)
        header.pack(fill="x")
        self.log_path_var = tk.StringVar(value=f"日志目录: {LOG_DIR}")
        tk.Label(header, textvariable=self.log_path_var, anchor="w", fg="#555").pack(side="left", fill="x", expand=True)
        tk.Button(header, text="清空显示", command=self._clear_log_display).pack(side="right")

        self.log_text_widget = scrolledtext.ScrolledText(self.log_window, wrap="word", state="disabled", font=("Consolas", 9))
        self.log_text_widget.pack(fill="both", expand=True, padx=8, pady=(0, 8))

        self.log_text_widget.tag_configure("INFO", foreground="#2c3e50")
        self.log_text_widget.tag_configure("AI", foreground="#2980b9")
        self.log_text_widget.tag_configure("THINK", foreground="#8e44ad")
        self.log_text_widget.tag_configure("EXEC", foreground="#16a085")
        self.log_text_widget.tag_configure("WARN", foreground="#d35400")
        self.log_text_widget.tag_configure("ERROR", foreground="#c0392b")

        self.log_window.protocol("WM_DELETE_WINDOW", self._on_log_window_close)

    def _on_log_window_close(self) -> None:
        if self.log_window:
            self.log_window.withdraw()

    def _clear_log_display(self) -> None:
        if not self.log_text_widget:
            return
        self.log_text_widget.configure(state="normal")
        self.log_text_widget.delete("1.0", "end")
        self.log_text_widget.configure(state="disabled")

    def _append_log_ui(self, level: str, message: str) -> None:
        def _do() -> None:
            stamp = datetime.now().strftime("%H:%M:%S")
            line = f"[{stamp}] [{level}] {message}\n"
            if self.log_text_widget and self.log_text_widget.winfo_exists():
                self.log_text_widget.configure(state="normal")
                self.log_text_widget.insert("end", line, level)
                self.log_text_widget.see("end")
                self.log_text_widget.configure(state="disabled")
            if (
                self.session_logger
                and self.session_logger.file_path
                and hasattr(self, "log_path_var")
                and self.log_window
                and self.log_window.winfo_exists()
            ):
                self.log_path_var.set(f"当前日志: {self.session_logger.file_path}")

        self.root.after(0, _do)

    def _show_error_overlay(self, title: str, detail: str) -> None:
        def _do() -> None:
            self.error_overlay_visible = True
            full = title
            if detail:
                full = f"{title}\n\n{detail}"
            self.error_text.configure(state="normal")
            self.error_text.delete("1.0", "end")
            self.error_text.insert("1.0", full)
            self.error_text.configure(state="disabled")
            if not self.error_overlay.winfo_ismapped():
                self.error_overlay.pack(fill="both", expand=True, padx=6, pady=(0, 6))
            if self.ui_mode == "compact":
                self.root.geometry(COMPACT_WITH_ERROR_GEOMETRY)
            self._set_status("异常", "#e67e22")

        self.root.after(0, _do)

    def _hide_error_overlay(self) -> None:
        self.error_overlay_visible = False
        self.error_overlay.pack_forget()
        if self.ui_mode == "compact":
            self.root.geometry(COMPACT_GEOMETRY)

    def _init_session_logger(self) -> None:
        self._ensure_log_window()
        self.session_logger = SessionLogger(
            ui_append=lambda lvl, msg: self._append_log_ui(lvl, msg),
            overlay_show=self._show_error_overlay,
        )
        self.session_logger.info("会话已创建", {"log_dir": LOG_DIR})

    @staticmethod
    def get_foreground_window_title() -> str:
        user32 = ctypes.windll.user32
        hwnd = user32.GetForegroundWindow()
        if not hwnd:
            return ""
        length = user32.GetWindowTextLengthW(hwnd)
        if length <= 0:
            return ""
        buff = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buff, length + 1)
        return buff.value.strip()

    def _init_global_hotkey(self) -> None:
        hotkey_str = self.hotkey_var.get().strip() if hasattr(self, "hotkey_var") else DEFAULT_HOTKEY
        try:
            self.hotkey_handler = keyboard.HotKey(
                keyboard.HotKey.parse(hotkey_str),
                lambda: self.root.after(0, self.emergency_stop),
            )
            listener_ref: dict[str, keyboard.Listener] = {}

            def _for_canonical(handler):
                return lambda key: handler(listener_ref["listener"].canonical(key))

            self.hotkey_listener = keyboard.Listener(
                on_press=_for_canonical(self.hotkey_handler.press),
                on_release=_for_canonical(self.hotkey_handler.release),
            )
            listener_ref["listener"] = self.hotkey_listener
            self.hotkey_listener.start()
        except Exception:
            pass

    def _reset_standard_system_prompt(self) -> None:
        self.system_prompt_text.delete("1.0", "end")
        self.system_prompt_text.insert("1.0", DEFAULT_SYSTEM_PROMPT)

    def capture_current_window_title(self) -> None:
        title = self.get_foreground_window_title()
        if not title:
            messagebox.showwarning("提示", "未读取到当前前台窗口标题")
            return
        self.target_window_var.set(title)

    def _set_status(self, label: str, color: str) -> None:
        self.compact_status_var.set(label)
        self.compact_status_dot.delete("all")
        self.compact_status_dot.create_oval(2, 2, 12, 12, fill=color, outline=color)

    def _tick_runtime_clock(self) -> None:
        if self.started_at and self.running_event.is_set():
            elapsed = int(time.time() - self.started_at)
            mm, ss = divmod(elapsed, 60)
            self.compact_runtime_var.set(f"{mm:02d}:{ss:02d}")
        self.root.after(500, self._tick_runtime_clock)

    def start_agent(self) -> None:
        api_key = self.api_key_var.get().strip()
        if not api_key:
            messagebox.showerror("缺少配置", "请先填写硅基流动 API Key")
            return
        if self.running_event.is_set():
            return

        if not self.session_logger:
            self._init_session_logger()

        self._hide_error_overlay()
        self._show_compact_mode()
        self._ensure_log_window()

        self.running_event.set()
        self.step_count = 0
        self.started_at = time.time()

        self.compact_start_btn.config(state="disabled")
        self.compact_pause_btn.config(state="normal")
        self.compact_close_btn.config(state="disabled")
        self.setup_start_btn.config(state="disabled")
        self._set_status("运行中", "#2ecc71")

        if self.session_logger:
            self.session_logger.info(
                "代理已启动",
                {
                    "model": self.model_var.get().strip(),
                    "interval": self.interval_var.get().strip(),
                    "target_window": self.target_window_var.get().strip(),
                },
            )

        self.worker_thread = threading.Thread(target=self._run_loop, daemon=True)
        self.worker_thread.start()

    def stop_agent(self) -> None:
        if not self.running_event.is_set() and self.step_count == 0:
            return
        self.running_event.clear()
        self._set_status("已暂停", "#7f8c8d")
        self.compact_start_btn.config(state="normal")
        self.compact_pause_btn.config(state="disabled")
        self.compact_close_btn.config(state="normal")
        self.setup_start_btn.config(state="normal")
        if self.session_logger:
            self.session_logger.info("代理已暂停")

    def emergency_stop(self) -> None:
        self.running_event.clear()
        self._set_status("急停", "#e67e22")
        self.compact_start_btn.config(state="normal")
        self.compact_pause_btn.config(state="disabled")
        self.compact_close_btn.config(state="normal")
        self.setup_start_btn.config(state="normal")
        if self.session_logger:
            self.session_logger.warn("触发紧急停止")

    def _is_target_window_active(self) -> bool:
        keyword = self.target_window_var.get().strip()
        if not self.require_focus_var.get():
            return True
        if not keyword:
            return False
        active_title = self.get_foreground_window_title()
        if not active_title:
            return False
        return keyword.lower() in active_title.lower()

    def _capture_screen_base64(self) -> tuple[str, int]:
        image = ImageGrab.grab()
        w, h = image.size
        long_edge = max(w, h)
        if long_edge > MAX_SCREENSHOT_LONG_EDGE:
            scale = MAX_SCREENSHOT_LONG_EDGE / long_edge
            image = image.resize(
                (int(w * scale), int(h * scale)),
                resample=Image.Resampling.LANCZOS,
            )
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=75, optimize=True)
        raw = buffer.getvalue()
        return base64.b64encode(raw).decode("utf-8"), len(raw)

    def _build_messages(self, screenshot_b64: str) -> list[dict]:
        system_prompt = self.system_prompt_text.get("1.0", "end").strip()
        task_prompt = self.task_prompt_text.get("1.0", "end").strip()
        action_spec = (
            "只返回一个 JSON 对象，严格区分「思考过程」与「最终执行」：\n"
            "{\n"
            '  "thinking": [\n'
            '    {"phase":"observe","content":"看到什么"},\n'
            '    {"phase":"analyze","content":"分析原因"},\n'
            '    {"phase":"plan","content":"打算怎么做"}\n'
            "  ],\n"
            '  "final": {\n'
            '    "summary": "最终决策一句话",\n'
            '    "steps": [\n'
            '      {"action":"click","x":0,"y":0},\n'
            '      {"action":"type","text":""},\n'
            '      {"action":"key","key":"enter"}\n'
            "    ]\n"
            "  }\n"
            "}\n"
            "规则：thinking 仅描述推理，禁止含 action/x/y；可执行操作只能放在 final.steps。"
            "phase 仅允许 observe|analyze|plan|confirm|note。"
            f"final.steps 最多 {MAX_SUBSTEPS_PER_RESPONSE} 步，action 仅 wait|click|key|type|stop。"
            "不确定时 final.steps 仅含一个 wait。"
        )
        user_text = (
            f"任务：{task_prompt}\n决策轮次：{self.step_count}\n"
            "请根据截图输出 thinking（过程）与 final.steps（本回合实际要执行的操作）。"
        )
        return [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{screenshot_b64}",
                            "detail": "low",
                        },
                    },
                    {"type": "text", "text": user_text + "\n" + action_spec},
                ],
            },
        ]

    def _messages_for_log(self, messages: list[dict], image_bytes: int) -> dict:
        out = []
        for msg in messages:
            role = msg.get("role", "")
            content = msg.get("content", "")
            if isinstance(content, list):
                parts = []
                for p in content:
                    if p.get("type") == "image_url":
                        parts.append(f"[screenshot {image_bytes} bytes]")
                    elif p.get("type") == "text":
                        parts.append(p.get("text", ""))
                out.append({"role": role, "content": "\n".join(parts)})
            else:
                out.append({"role": role, "content": content})
        return {"messages": out}

    def _request_action(self, messages: list[dict], image_bytes: int) -> AgentPlan:
        api_key = self.api_key_var.get().strip()
        model = self.model_var.get().strip() or DEFAULT_MODEL

        if self.session_logger:
            self.session_logger.ai_io(
                "请求 → 模型",
                {
                    "summary": f"→ API step={self.step_count} model={model}",
                    "url": API_BASE_URL,
                    "payload": self._messages_for_log(messages, image_bytes),
                },
            )

        payload = {
            "model": model,
            "messages": messages,
            "temperature": 0.2,
            "max_tokens": 960,
            "stream": False,
        }
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        timeout = (API_CONNECT_TIMEOUT, API_READ_TIMEOUT)

        resp = None
        for attempt in range(API_RETRY_COUNT + 1):
            try:
                resp = requests.post(API_BASE_URL, headers=headers, json=payload, timeout=timeout)
                break
            except (requests.ReadTimeout, requests.ConnectionError) as err:
                if attempt >= API_RETRY_COUNT:
                    raise
                if self.session_logger:
                    self.session_logger.warn(
                        f"API 超时/连接失败，{API_RETRY_BACKOFF_SEC:.0f}s 后重试 "
                        f"({attempt + 1}/{API_RETRY_COUNT})",
                        {"error": str(err)},
                    )
                time.sleep(API_RETRY_BACKOFF_SEC)

        if resp is None:
            raise RuntimeError("API 请求未返回响应")

        if resp.status_code >= 400:
            raise requests.HTTPError(
                f"API 请求失败 HTTP {resp.status_code}",
                response=resp,
            )

        data = resp.json()
        content = data["choices"][0]["message"]["content"]
        if isinstance(content, list):
            content = "".join(
                part.get("text", "") if isinstance(part, dict) else str(part) for part in content
            )

        if self.session_logger:
            self.session_logger.ai_io(
                "响应 ← 模型",
                {"summary": f"← 原始输出 step={self.step_count}", "raw_content": content},
            )

        return self._parse_plan_json(content)

    def _action_from_dict(self, obj: dict) -> AgentAction:
        action = str(obj.get("action", ACTION_WAIT)).lower().strip()
        if action not in ALLOWED_ACTIONS:
            action = ACTION_WAIT
        return AgentAction(
            action=action,
            x=self._safe_int(obj.get("x")),
            y=self._safe_int(obj.get("y")),
            key=self._safe_str(obj.get("key")),
            text=self._safe_str(obj.get("text")),
            duration=self._safe_float(obj.get("duration"), 0.2),
            reason=self._safe_str(obj.get("reason")) or "",
        )

    @staticmethod
    def _action_to_dict(act: AgentAction) -> dict:
        return {
            "action": act.action,
            "x": act.x,
            "y": act.y,
            "key": act.key,
            "text": act.text,
            "duration": act.duration,
            "reason": act.reason,
        }

    def _normalize_thinking_phase(self, phase: str | None) -> str:
        p = (phase or "note").lower().strip()
        return p if p in THINKING_PHASES else "note"

    def _parse_thinking(self, raw_thinking) -> list[ThinkingStep]:
        items: list[ThinkingStep] = []
        if raw_thinking is None:
            return items
        if isinstance(raw_thinking, str) and raw_thinking.strip():
            return [ThinkingStep(phase="note", content=raw_thinking.strip(), index=1)]
        if not isinstance(raw_thinking, list):
            return items

        for i, item in enumerate(raw_thinking[:MAX_THINKING_ITEMS], start=1):
            if isinstance(item, str) and item.strip():
                items.append(ThinkingStep(phase="note", content=item.strip(), index=i))
                continue
            if not isinstance(item, dict):
                continue
            content = self._safe_str(item.get("content")) or self._safe_str(item.get("text")) or ""
            if not content.strip():
                continue
            phase = self._normalize_thinking_phase(self._safe_str(item.get("phase")))
            items.append(ThinkingStep(phase=phase, content=content.strip(), index=i))
        return items

    def _parse_steps_list(self, raw_steps) -> list[AgentAction]:
        steps: list[AgentAction] = []
        if not isinstance(raw_steps, list):
            return steps
        for item in raw_steps[:MAX_SUBSTEPS_PER_RESPONSE]:
            if not isinstance(item, dict):
                continue
            act = self._action_from_dict(item)
            steps.append(act)
            if act.action == ACTION_STOP:
                break
        return steps

    @staticmethod
    def _thinking_to_dict(t: ThinkingStep) -> dict:
        return {"index": t.index, "phase": t.phase, "content": t.content}

    def _log_parsed_plan(self, plan: AgentPlan) -> None:
        if not self.session_logger:
            return
        if plan.thinking:
            for t in plan.thinking:
                self.session_logger.think(
                    f"[{t.index}] {t.phase}: {t.content[:120]}",
                    {"thinking_item": self._thinking_to_dict(t)},
                )
            self.session_logger.think(
                f"思考过程共 {len(plan.thinking)} 条（不执行）",
                {"thinking": [self._thinking_to_dict(t) for t in plan.thinking]},
            )
        else:
            self.session_logger.warn("模型未返回 thinking 过程，仅解析 final.steps")

        self.session_logger.exec_plan(
            f"最终执行 {len(plan.steps)} 步 — {plan.decision_summary or plan.reason or '-'}",
            {
                "decision_summary": plan.decision_summary,
                "executable_steps": [self._action_to_dict(s) for s in plan.steps],
            },
        )

    def _parse_plan_json(self, raw_text: str) -> AgentPlan:
        text = raw_text.strip()
        if text.startswith("```"):
            text = text.strip("`").replace("json", "", 1).strip()

        try:
            obj = json.loads(text)
        except Exception:
            l, r = text.find("{"), text.rfind("}")
            if l >= 0 and r > l:
                obj = json.loads(text[l : r + 1])
            else:
                if self.session_logger:
                    self.session_logger.warn("模型输出无法解析为 JSON", {"raw": raw_text[:500]})
                return AgentPlan(
                    thinking=[],
                    steps=[AgentAction(action=ACTION_WAIT, duration=1.0, reason="json parse failed")],
                    decision_summary="parse failed",
                    reason="parse failed",
                )

        thinking = self._parse_thinking(obj.get("thinking"))

        final_block = obj.get("final")
        decision_summary = ""
        raw_steps = None

        if isinstance(final_block, dict):
            decision_summary = (
                self._safe_str(final_block.get("summary"))
                or self._safe_str(final_block.get("reason"))
                or ""
            )
            raw_steps = final_block.get("steps")
        else:
            decision_summary = self._safe_str(obj.get("reason")) or ""
            raw_steps = obj.get("steps")

        steps = self._parse_steps_list(raw_steps)
        if not steps and "action" in obj:
            steps = [self._action_from_dict(obj)]
            if not decision_summary:
                decision_summary = steps[0].reason

        if not steps:
            steps = [AgentAction(action=ACTION_WAIT, duration=0.5, reason="empty final.steps")]

        reason = decision_summary or self._safe_str(obj.get("reason")) or ""
        plan = AgentPlan(
            thinking=thinking,
            steps=steps,
            decision_summary=decision_summary,
            reason=reason,
        )
        self._log_parsed_plan(plan)
        return plan

    @staticmethod
    def _safe_int(v) -> int | None:
        try:
            if v is None or v == "":
                return None
            return int(float(v))
        except Exception:
            return None

    @staticmethod
    def _safe_float(v, default: float) -> float:
        try:
            if v is None or v == "":
                return default
            return max(0.0, min(5.0, float(v)))
        except Exception:
            return default

    @staticmethod
    def _safe_str(v) -> str | None:
        if v is None:
            return None
        return str(v)

    def _execute_single_action(self, act: AgentAction, sub_index: int, sub_total: int) -> str:
        """执行单步。返回 ok | skip | stop。"""
        prefix = f"{sub_index + 1}/{sub_total} "

        if not self._is_target_window_active():
            hint = "目标窗口未激活，跳过"
            self.compact_last_var.set(hint[:40])
            if self.session_logger:
                self.session_logger.warn(
                    hint,
                    {
                        "substep": sub_index + 1,
                        "expected_keyword": self.target_window_var.get().strip(),
                        "foreground": self.get_foreground_window_title(),
                    },
                )
            return "skip"

        if act.action == ACTION_WAIT:
            time.sleep(max(0.2, act.duration))
            self.compact_last_var.set(f"{prefix}wait {act.duration:.1f}s")
            return "ok"

        if act.action == ACTION_CLICK:
            if act.x is None or act.y is None:
                if self.session_logger:
                    self.session_logger.warn("click 缺少坐标", {"substep": sub_index + 1})
                return "skip"
            pyautogui.click(act.x, act.y)
            self.compact_last_var.set(f"{prefix}click ({act.x},{act.y})")
            return "ok"

        if act.action == ACTION_KEY:
            if not act.key:
                if self.session_logger:
                    self.session_logger.warn("key 缺少键值", {"substep": sub_index + 1})
                return "skip"
            pyautogui.press(act.key)
            self.compact_last_var.set(f"{prefix}key {act.key}")
            return "ok"

        if act.action == ACTION_TYPE:
            if not act.text:
                if self.session_logger:
                    self.session_logger.warn("type 缺少文本", {"substep": sub_index + 1})
                return "skip"
            pyautogui.typewrite(act.text, interval=0.03)
            self.compact_last_var.set(f"{prefix}type")
            return "ok"

        if act.action == ACTION_STOP:
            if self.session_logger:
                self.session_logger.info("模型返回 stop，自动停止")
            self.root.after(0, self.stop_agent)
            return "stop"

        return "skip"

    def _execute_plan(self, plan: AgentPlan) -> None:
        total = len(plan.steps)
        for idx, act in enumerate(plan.steps):
            if not self.running_event.is_set():
                break
            if self.session_logger:
                self.session_logger.info(f"  子步骤 {idx + 1}/{total}: {act.action}")
            result = self._execute_single_action(act, idx, total)
            if result == "stop":
                break
            if idx < total - 1 and result == "ok" and act.action not in (ACTION_STOP,):
                time.sleep(SUBSTEP_DELAY_SEC)

    def _handle_loop_error(self, err: BaseException, context: str) -> None:
        detail = format_exception(err)
        short = f"{context}: {err}"
        if self.session_logger:
            self.session_logger.error(short, detail)
        else:
            self._show_error_overlay(short, detail)

    def _run_loop(self) -> None:
        try:
            interval = float(self.interval_var.get().strip() or DEFAULT_INTERVAL)
            interval = max(MIN_INTERVAL, min(MAX_INTERVAL, interval))
        except Exception:
            interval = DEFAULT_INTERVAL

        try:
            max_steps = int(float(self.max_steps_var.get().strip() or DEFAULT_MAX_STEPS))
            max_steps = max(1, min(10000, max_steps))
        except Exception:
            max_steps = DEFAULT_MAX_STEPS

        while self.running_event.is_set():
            if self.step_count >= max_steps:
                if self.session_logger:
                    self.session_logger.info(f"达到最大步数 {max_steps}，自动停止")
                self.root.after(0, self.stop_agent)
                break

            self.step_count += 1
            try:
                screenshot_b64, img_bytes = self._capture_screen_base64()
                messages = self._build_messages(screenshot_b64)
                plan = self._request_action(messages, img_bytes)
                summary = (plan.decision_summary or plan.reason or "")[:36]
                self.root.after(
                    0,
                    lambda s=summary, n=len(plan.steps): self.compact_last_var.set(
                        f"决策:{s} | 执行{n}步"
                    ),
                )
                if self.session_logger:
                    self.session_logger.info(
                        f"Step {self.step_count}：思考 {len(plan.thinking)} 条，执行 {len(plan.steps)} 步"
                    )
                self._execute_plan(plan)
            except Exception as err:
                self._handle_loop_error(err, f"Step {self.step_count} 失败")
                time.sleep(1.5)

            slept = 0.0
            while self.running_event.is_set() and slept < interval:
                time.sleep(0.1)
                slept += 0.1

    def _on_close(self) -> None:
        self.running_event.clear()
        if self.hotkey_listener:
            try:
                self.hotkey_listener.stop()
            except Exception:
                pass
        if self.log_window and self.log_window.winfo_exists():
            self.log_window.destroy()
        self.root.destroy()

    def run(self) -> None:
        self.root.mainloop()


if __name__ == "__main__":
    app = SiliconFlowGamePetDemo()
    app.run()
