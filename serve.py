#!/usr/bin/env python3
"""本地服务器启动器 —— 双击或在终端运行即可。

为什么需要它
------------
浏览器在 file:// 协议下把页面视为 opaque origin，会禁用
fetch() / XMLHttpRequest / 动态 import()，MediaPipe 的运行时、
wasm 与模型文件因而加载不到（表现为「手部模型加载失败」）。

游戏本身已内置内联兜底，双击 index.html 也能用；
但走 HTTP 更快更稳，摄像头权限也更好申请，所以推荐用本脚本启动。

用法：
    python serve.py              # 默认 8931 端口并自动打开浏览器
    python serve.py 9000         # 指定端口
"""
import http.server
import os
import socket
import socketserver
import sys
import threading
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
DEFAULT_PORT = 8931


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # 开发期禁用缓存，改了资源立刻生效
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # 只在出错时打印，正常请求静默
        if not str(args[1] if len(args) > 1 else "").startswith("2"):
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) != 0


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT
    if not port_free(port):
        print(f"[!] 端口 {port} 已被占用，可能服务器已在运行。")
        print(f"    直接访问：http://127.0.0.1:{port}/index.html")
        webbrowser.open(f"http://127.0.0.1:{port}/index.html")
        return

    url = f"http://127.0.0.1:{port}/index.html"
    print("=" * 60)
    print("  烹香物语 · 本地服务器")
    print("=" * 60)
    print(f"  地址：{url}")
    print("  提示：摄像头手势需要 http 环境，请不要直接双击 index.html")
    print("  按 Ctrl+C 停止服务器")
    print()

    threading.Timer(0.8, lambda: webbrowser.open(url)).start()

    with Server(("127.0.0.1", port), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n服务器已停止。")


if __name__ == "__main__":
    main()
