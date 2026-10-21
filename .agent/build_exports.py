#!/usr/bin/env python3
"""
Build export files for SD-WAN Lab Architecture:
- docs/LAB_NETWORK_ARCHITECTURE_HLD_LLD.html
- docs/LAB_NETWORK_ARCHITECTURE_HLD_LLD.enex
Embeds the rendered topology PNG as both Base64 and Evernote ENML resource.
"""
import os
import re
import hashlib
import base64
import html
from datetime import datetime
from markdown_it import MarkdownIt

def main():
    md_file = "docs/LAB_NETWORK_ARCHITECTURE_HLD_LLD.md"
    html_file = "docs/LAB_NETWORK_ARCHITECTURE_HLD_LLD.html"
    enex_file = "docs/LAB_NETWORK_ARCHITECTURE_HLD_LLD.enex"
    png_file = "docs/lab_network_topology.png"

    with open(md_file, "r", encoding="utf-8") as f:
        md_content = f.read()

    # Read PNG and compute hash
    with open(png_file, "rb") as f:
        png_bytes = f.read()

    png_md5 = hashlib.md5(png_bytes).hexdigest()
    png_b64 = base64.b64encode(png_bytes).decode("ascii")
    # ENEX requires base64 lines wrapped around 76 characters
    png_b64_wrapped = "\n".join(png_b64[i:i+76] for i in range(0, len(png_b64), 76))

    # Convert markdown to HTML using markdown-it
    md = MarkdownIt()
    rendered_body = md.render(md_content)

    # 1. GENERATE STANDALONE HTML
    # Replace relative image reference with base64 data URI
    html_body = rendered_body.replace(
        'src="lab_network_topology.png"',
        f'src="data:image/png;base64,{png_b64}" style="max-width:100%; height:auto; border:1px solid #cbd5e1; border-radius:8px; box-shadow:0 4px 6px -1px rgba(0,0,0,0.1); margin:16px 0;"'
    )

    standalone_html = f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SD-WAN Lab Network Architecture & Interconnect Reference (HLD / LLD)</title>
<style>
  body {{
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.6;
    color: #1e293b;
    max-width: 1050px;
    margin: 40px auto;
    padding: 0 24px;
    background-color: #ffffff;
  }}
  h1 {{ border-bottom: 2px solid #e2e8f0; padding-bottom: 0.3em; color: #0f172a; margin-top: 1.5em; }}
  h2 {{ border-bottom: 1px solid #e2e8f0; padding-bottom: 0.3em; margin-top: 2em; color: #1e293b; }}
  h3 {{ margin-top: 1.5em; color: #334155; }}
  h4 {{ margin-top: 1.2em; color: #475569; }}
  table {{
    border-collapse: collapse;
    width: 100%;
    margin: 20px 0;
    font-size: 14px;
  }}
  th, td {{
    border: 1px solid #cbd5e1;
    padding: 10px 14px;
    text-align: left;
  }}
  th {{
    background-color: #f1f5f9;
    font-weight: 600;
    color: #0f172a;
  }}
  tr:nth-child(even) {{ background-color: #f8fafc; }}
  code {{
    background-color: #f1f5f9;
    color: #0f172a;
    padding: 0.2em 0.4em;
    border-radius: 4px;
    font-size: 88%;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  }}
  pre {{
    background-color: #0f172a;
    color: #e2e8f0;
    border-radius: 8px;
    padding: 16px;
    overflow-x: auto;
    font-size: 13px;
    line-height: 1.5;
  }}
  pre code {{
    background-color: transparent;
    color: inherit;
    padding: 0;
  }}
  blockquote {{
    border-left: 4px solid #0284c7;
    padding: 12px 16px;
    color: #475569;
    background-color: #f0f9ff;
    border-radius: 0 6px 6px 0;
    margin: 20px 0;
  }}
  img {{
    display: block;
    max-width: 100%;
    height: auto;
  }}
  details {{
    margin: 16px 0;
    padding: 12px;
    background-color: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
  }}
  summary {{
    cursor: pointer;
    font-weight: 600;
    color: #0284c7;
  }}
</style>
</head>
<body>
{html_body}
</body>
</html>"""

    with open(html_file, "w", encoding="utf-8") as f:
        f.write(standalone_html)
    print(f"Generated standalone HTML: {html_file}")

    # 2. GENERATE EVERNOTE ENEX WITH EMBEDDED RESOURCE
    # Evernote ENML requires:
    # - Strict XML compliance
    # - Replace <img> with <en-media type="image/png" hash="MD5" />
    # - Strip prohibited tags (<script>, <style>, <details>, <summary>, etc.)
    # - Clean blockquotes and pre tags
    
    enml_body = rendered_body

    # Replace the image tag with Evernote en-media tag
    enml_body = re.sub(
        r'<p><img\s+src="lab_network_topology\.png"\s+alt="[^"]*"\s*/?></p>',
        f'<div style="text-align:center; margin: 20px 0;"><en-media type="image/png" hash="{png_md5}"/></div>',
        enml_body
    )
    # Also catch non-paragraph <img> if any
    enml_body = re.sub(
        r'<img\s+src="lab_network_topology\.png"\s+alt="[^"]*"\s*/?>',
        f'<en-media type="image/png" hash="{png_md5}"/>',
        enml_body
    )

    # Transform <details><summary> into simple div or remove raw mermaid block in Evernote
    # Remove raw mermaid block inside Evernote so it never shows unparsed code!
    enml_body = re.sub(
        r'<details>\s*<summary>.*?</summary>\s*<pre><code class="language-mermaid">.*?</code></pre>\s*</details>',
        '',
        enml_body,
        flags=re.DOTALL
    )

    # Style pre / code blocks in ENML
    enml_body = enml_body.replace(
        '<pre><code class="language-text">',
        '<pre style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; background-color: #f8fafc; border: 1px solid #cbd5e1; padding: 12px; border-radius: 6px; overflow-x: auto; line-height: 1.35;">'
    )
    enml_body = enml_body.replace(
        '<pre><code',
        '<pre style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background-color: #f1f5f9; border: 1px solid #e2e8f0; padding: 12px; border-radius: 6px; overflow-x: auto;"><code'
    )
    enml_body = enml_body.replace(
        '<table>',
        '<table style="border-collapse: collapse; width: 100%; margin: 16px 0; font-size: 13px;">'
    )
    enml_body = enml_body.replace(
        '<th>',
        '<th style="border: 1px solid #cbd5e1; padding: 8px 12px; background-color: #f1f5f9; text-align: left; font-weight: 600;">'
    )
    enml_body = enml_body.replace(
        '<td>',
        '<td style="border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left;">'
    )
    enml_body = enml_body.replace(
        '<blockquote>',
        '<blockquote style="border-left: 4px solid #0284c7; padding: 8px 16px; margin: 16px 0; background-color: #f0f9ff; color: #475569;">'
    )

    now_iso = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")

    enex_content = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export4.dtd">
<en-export export-date="{now_iso}" application="Evernote" version="10.x">
  <note>
    <title>SD-WAN Lab Network Architecture &amp; Interconnect Reference (HLD / LLD)</title>
    <content>
      <![CDATA[<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">
<en-note>
{enml_body}
</en-note>]]>
    </content>
    <created>{now_iso}</created>
    <updated>{now_iso}</updated>
    <tag>SD-WAN</tag>
    <tag>Lab</tag>
    <tag>Stigix</tag>
    <tag>VyOS</tag>
    <tag>KVM</tag>
    <resource>
      <data encoding="base64">
{png_b64_wrapped}
      </data>
      <mime>image/png</mime>
      <width>1150</width>
      <height>780</height>
      <resource-attributes>
        <file-name>lab_network_topology.png</file-name>
      </resource-attributes>
    </resource>
  </note>
</en-export>
"""

    with open(enex_file, "w", encoding="utf-8") as f:
        f.write(enex_content)
    print(f"Generated Evernote ENEX with embedded image: {enex_file}")

if __name__ == "__main__":
    main()
