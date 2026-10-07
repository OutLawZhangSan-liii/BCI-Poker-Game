import json
import os
import subprocess
import sys
import unittest


class GatewayAppTests(unittest.TestCase):
    def test_readiness_and_stdin_shutdown(self) -> None:
        environment = dict(os.environ)
        environment["BRAIN_GAME_GATEWAY_TOKEN"] = "sidecar-test-token"
        process = subprocess.Popen(
            [sys.executable, "-m", "device_gateway.gateway_app", "--port", "0"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=environment,
        )
        try:
            ready = json.loads(process.stdout.readline())
            self.assertEqual(ready["type"], "gateway_ready")
            self.assertTrue(ready["url"].startswith("ws://127.0.0.1:"))
            process.stdin.write("shutdown\n")
            process.stdin.flush()
            self.assertEqual(process.wait(timeout=3), 0)
        finally:
            if process.poll() is None:
                process.kill()
            for stream in (process.stdin, process.stdout, process.stderr):
                if stream is not None:
                    stream.close()


if __name__ == "__main__":
    unittest.main()
