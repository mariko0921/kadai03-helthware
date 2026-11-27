#!/usr/bin/env python3
"""
Oura API から直近の健康データを取得して exports/oura-export.json に保存する。

なぜこのスクリプトが必要か:
  Oura API はブラウザからの呼び出しを CORS で拒否するため、
  サーバー（=このPC上のターミナル）から取得し、ファイル経由でアプリに渡す。

使い方:
  python3 scripts/fetch_oura.py          # 直近7日
  python3 scripts/fetch_oura.py 14       # 直近14日

安全のため:
  - トークンは実行時に貼り付けるだけ（ファイルにも画面にも残さない）
  - 出力先 exports/ は .gitignore 済み（GitHubに上がらない）
"""
import getpass
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

API_BASE = "https://api.ouraring.com/v2/usercollection"

# 取得するデータの種類（Oura API のエンドポイント名）
ENDPOINTS = [
    "daily_readiness",  # コンディションスコア・体温の変動
    "daily_sleep",      # 睡眠スコア
    "sleep",            # 睡眠時間・HRV・心拍（1日に複数件あることも）
    "daily_activity",   # 歩数・活動カロリー
    "daily_stress",     # ストレス
]


def fetch(endpoint, token, start, end):
    """1つのエンドポイントから全件取得（next_token でページ送り）"""
    items = []
    next_token = None
    while True:
        params = {"start_date": start, "end_date": end}
        if next_token:
            params["next_token"] = next_token
        url = f"{API_BASE}/{endpoint}?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(url, headers={
            "Authorization": f"Bearer {token}",
            "User-Agent": "ogaru-personal-import/1.0",  # Oura は User-Agent 必須
        })
        with urllib.request.urlopen(req, timeout=30) as res:
            body = json.load(res)
        items.extend(body.get("data", []))
        next_token = body.get("next_token")
        if not next_token:
            return items


def main():
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 7
    start = (date.today() - timedelta(days=days - 1)).isoformat()
    # 終了日は「翌日」を指定（今日の分を確実に含めるため）
    end = (date.today() + timedelta(days=1)).isoformat()

    print("ブラウザの「トークンをコピー」で取得した Oura トークンを貼り付けて Enter")
    print("（入力しても画面には表示されません）")
    token = getpass.getpass("Oura token: ").strip()
    if not token:
        sys.exit("トークンが空です")

    export = {
        "format": "ogaru-oura-export",  # アプリ側で「正しいファイルか」を確認する目印
        "version": 1,
        "exportedAt": datetime.now(timezone.utc).isoformat(),
        "startDate": start,
        "endDate": end,
    }
    for ep in ENDPOINTS:
        try:
            export[ep] = fetch(ep, token, start, end)
            print(f"  ✅ {ep}: {len(export[ep])}件")
        except urllib.error.HTTPError as e:
            # 401 = トークン切れ/不正, 403 = スコープ不足 or メンバーシップ
            print(f"  ❌ {ep}: HTTP {e.code}")
            export[ep] = []

    os.makedirs("exports", exist_ok=True)
    path = os.path.join("exports", "oura-export.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(export, f, ensure_ascii=False, indent=2)
    print(f"\n保存しました: {path}（{start} 〜 今日）")


if __name__ == "__main__":
    main()
