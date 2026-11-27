#!/usr/bin/env python3
"""
HealthPlanet（タニタ）API から体組成データを取得して exports/healthplanet-export.json に保存する。

なぜこのスクリプトが必要か:
  HealthPlanet はトークン交換に client_secret が必須。
  secret をブラウザ（=誰でも中身を見られる場所）に置けないため、このPC上で処理する。

使い方:
  python3 scripts/fetch_healthplanet.py        # 直近90日（APIの上限は3か月）
  python3 scripts/fetch_healthplanet.py 30     # 直近30日

安全のため:
  - client_id / client_secret は scripts/healthplanet-config.json（.gitignore 済み）から読む
  - トークンは scripts/.healthplanet-token.json（.gitignore 済み）に保存し、期限内は再利用
  - 出力先 exports/ は .gitignore 済み
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(HERE, "healthplanet-config.json")
TOKEN_PATH = os.path.join(HERE, ".healthplanet-token.json")

AUTH_URL = "https://www.healthplanet.jp/oauth/auth"
TOKEN_URL = "https://www.healthplanet.jp/oauth/token"
DATA_URL = "https://www.healthplanet.jp/status/innerscan.json"
REDIRECT_URI = "https://www.healthplanet.jp/success.html"

# 取得する項目（タグ番号）
TAGS = {
    "6021": "体重",
    "6022": "体脂肪率",
    "6023": "筋肉量",
    "6024": "筋肉スコア",
    "6025": "内臓脂肪レベル2（小数）",
    "6026": "内臓脂肪レベル",
    "6027": "基礎代謝量",
    "6028": "体内年齢",
    "6029": "推定骨量",
}

JST = timezone(timedelta(hours=9))


def http(url, data=None):
    """GET（data=None）または POST（data=dict）して JSON を返す"""
    body = urllib.parse.urlencode(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers={"User-Agent": "ogaru-personal-import/1.0"})
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.load(res)


def load_config():
    if not os.path.exists(CONFIG_PATH):
        sys.exit(f"{CONFIG_PATH} がありません。healthplanet-config.example.json をコピーして作成してください")
    cfg = json.load(open(CONFIG_PATH, encoding="utf-8"))
    if "YOUR_" in cfg.get("client_id", "") or "YOUR_" in cfg.get("client_secret", ""):
        sys.exit("healthplanet-config.json に client_id / client_secret を入れてください")
    return cfg


def get_token(cfg):
    """保存済みトークンが有効ならそれを使い、無ければブラウザで認証して取得する"""
    if os.path.exists(TOKEN_PATH):
        saved = json.load(open(TOKEN_PATH))
        if saved.get("expires_at", 0) > time.time() + 60:
            print("保存済みのトークンを使います（期限内）")
            return saved["access_token"]

    # ① 認証画面を開く
    params = urllib.parse.urlencode({
        "client_id": cfg["client_id"],
        "redirect_uri": REDIRECT_URI,
        "scope": "innerscan",       # 体組成計のデータだけを許可してもらう
        "response_type": "code",
    })
    url = f"{AUTH_URL}?{params}"
    print("\nブラウザで HealthPlanet の認証画面を開きます。ログインして「許可」を押してください。")
    print(f"（開かない場合はこのURLを開いてください）\n{url}\n")
    webbrowser.open(url)

    # ② 表示されたコードを貼り付けてもらう（URLごと貼ってもOK）
    raw = input("success.html に表示されたコード（またはそのページのURL全体）を貼り付けて Enter: ").strip()
    if "code=" in raw:
        raw = urllib.parse.parse_qs(urllib.parse.urlparse(raw).query).get("code", [raw])[0]
    if not raw:
        sys.exit("コードが空です")

    # ③ コード → トークンに交換（client_secret はここでだけ使う）
    try:
        res = http(TOKEN_URL, {
            "client_id": cfg["client_id"],
            "client_secret": cfg["client_secret"],
            "redirect_uri": REDIRECT_URI,
            "code": raw,
            "grant_type": "authorization_code",
        })
    except urllib.error.HTTPError as e:
        sys.exit(f"トークンの取得に失敗しました（HTTP {e.code}）。コードは10分で期限切れになるので、もう一度実行してください")

    token = res.get("access_token")
    if not token:
        sys.exit("トークンが返ってきませんでした。もう一度実行してください")

    expires_in = int(res.get("expires_in", 30 * 24 * 3600))
    json.dump({"access_token": token, "expires_at": time.time() + expires_in}, open(TOKEN_PATH, "w"))
    os.chmod(TOKEN_PATH, 0o600)  # 自分だけが読めるファイルにする
    print("✅ トークンを取得しました")
    return token


def main():
    days = min(int(sys.argv[1]) if len(sys.argv) > 1 else 90, 90)  # APIの上限は3か月
    cfg = load_config()
    token = get_token(cfg)

    now = datetime.now(JST)
    start = now - timedelta(days=days)
    try:
        res = http(DATA_URL + "?" + urllib.parse.urlencode({
            "access_token": token,
            "date": 1,  # 1 = 測定日で検索
            "from": start.strftime("%Y%m%d000000"),
            "to": now.strftime("%Y%m%d%H%M%S"),
            "tag": ",".join(TAGS.keys()),
        }))
    except urllib.error.HTTPError as e:
        if e.code in (401, 403) and os.path.exists(TOKEN_PATH):
            os.remove(TOKEN_PATH)  # トークン切れ → 消して次回は再認証
        sys.exit(f"データの取得に失敗しました（HTTP {e.code}）。もう一度実行してください")

    records = res.get("data", [])
    export = {
        "format": "ogaru-healthplanet-export",  # アプリ側で「正しいファイルか」を確認する目印
        "version": 1,
        "exportedAt": datetime.now(timezone.utc).isoformat(),
        "height": res.get("height"),  # BMIの計算に使う（cm）
        "data": records,              # [{ date: "202611270712", keydata: "52.30", tag: "6021", model: ... }]
    }

    os.makedirs("exports", exist_ok=True)
    path = os.path.join("exports", "healthplanet-export.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(export, f, ensure_ascii=False, indent=2)

    # 件数だけ表示（値は表示しない）
    print(f"\n取得件数（直近{days}日）:")
    for tag, label in TAGS.items():
        n = sum(1 for r in records if r.get("tag") == tag)
        print(f"  {'✅' if n else '－'} {label}: {n}件")
    print(f"身長の登録: {'あり' if export['height'] else 'なし（BMIは計算できません）'}")
    print(f"\n保存しました: {path}")


if __name__ == "__main__":
    main()
