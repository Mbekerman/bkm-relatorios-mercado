"""PDF do relatório: o HTML do motor aberto no Chromium (Playwright) com uma folha de impressão própria.

A página do motor desenha os gráficos em SVG pela largura da tela e tem uma tabela com os números de cada
gráfico (o que aparece no hover também está nas tabelas, menos a lista de nomes dos lançamentos, que está na
lista de empreendimentos de cada cenário, aberta no PDF). Por isso a janela do Chromium tem a largura útil da
folha A4 deitada: os gráficos já nascem no tamanho certo.
"""
import asyncio
from playwright.async_api import async_playwright
import config

LARGURA = 1046  # A4 deitado (297 mm) menos 2 × 10 mm de margem, em px CSS (96 por polegada)

IMPRESSAO = """
<style id="bkm-impressao">
@page { size: A4 landscape; }
html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { padding: 0 !important; font-size: 12px; }
body::before { display: none !important; }
.topo { position: static !important; margin: 0 0 12px !important; padding: 10px 16px !important; }
.wrap { margin-top: 0 !important; gap: 18px !important; max-width: none !important; }
h1 { font-size: 26px !important; }
h2 { font-size: 18px !important; break-after: avoid; page-break-after: avoid; }
section { padding-top: 12px !important; gap: 10px !important; }
/* cada métrica começa numa folha: o título nunca fica sozinho no pé da página */
#lanc, #oferta, #lancvend, #preco, #pct, #vso, #indice, #curvas, #tabela { break-before: page; page-break-before: always; border-top: 0 !important; padding-top: 0 !important; }
#pct td, #pct th { white-space: normal !important; font-size: 10px !important; padding: 3px 4px !important; }
.grid2 { grid-template-columns: repeat(var(--nr, 2), minmax(0, 1fr)) !important; gap: 20px !important; }
.grid2.um { grid-template-columns: 1fr !important; }
/* capa: recortes e cenários cabem na primeira folha (pedido do Moises, 17/nov/2026) */
#recortes { gap: 6px !important; }
#recortes dl, #recortes .kv { font-size: 10.5px !important; gap: 1px 12px !important; line-height: 1.3; }
.cards { grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)) !important; gap: 10px !important; }
.card { padding: 8px 14px !important; gap: 4px !important; break-inside: avoid !important; page-break-inside: avoid !important; }
.card h3 { font-size: 15px !important; margin: 0 !important; }
.card .kv { font-size: 11.5px !important; gap: 1px 12px !important; }
.elist { columns: 3 !important; font-size: 11px; }
.mini, .tbl, .chart, .legend, .raio, header, #recortes { break-inside: avoid; page-break-inside: avoid; }
.col > .raio { break-after: avoid; }
table { font-size: 11px !important; }
th, td { padding: 3px 6px !important; }
.tbl { overflow: visible !important; }
summary { list-style: none; color: var(--fg) !important; }
summary::-webkit-details-marker { display: none; }
#tip { display: none !important; }
/* a lista de empreendimentos pesquisados fica só na tela (pedido do Moises, 17/nov/2026) */
.card details, .card details ~ p { display: none !important; }
</style>
"""

RODAPE = ('<div style="font-size:8px;width:100%;padding:0 10mm;color:#5a5f68;font-family:Arial,sans-serif;'
          'display:flex;justify-content:space-between"><span>BKM · Inteligência de Mercado</span>'
          '<span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>')

_trava = asyncio.Lock()
_pw = None
_nav = None


async def _navegador():
    global _pw, _nav
    async with _trava:
        if _nav is None or not _nav.is_connected():
            _pw = _pw or await async_playwright().start()
            _nav = await _pw.chromium.launch(executable_path=config.CHROMIUM_PATH,
                                             args=['--no-sandbox', '--disable-dev-shm-usage'])
    return _nav


def preparar_html(html):
    """Põe a folha de impressão depois do <style> do motor (que não tem <head>) e garante tema claro."""
    i = html.find('</style>')
    html = html[:i + 8] + IMPRESSAO + html[i + 8:] if i >= 0 else IMPRESSAO + html
    return html.replace('<html', '<html data-theme="light"', 1) if '<html' in html else html


async def gerar(html):
    nav = await _navegador()
    ctx = await nav.new_context(viewport={'width': LARGURA, 'height': 1400}, color_scheme='light')
    try:
        p = await ctx.new_page()
        await p.emulate_media(media='print', color_scheme='light')
        await p.set_content(preparar_html(html), wait_until='networkidle', timeout=60000)
        await p.evaluate("""() => { document.documentElement.setAttribute('data-theme','light');
            document.querySelectorAll('details').forEach(d => d.open = true);
            return document.fonts ? document.fonts.ready.then(() => true) : true; }""")
        await p.wait_for_timeout(300)  # o ResizeObserver do motor redesenha depois de 120 ms
        return await p.pdf(format='A4', landscape=True, print_background=True,
                           margin={'top': '10mm', 'bottom': '12mm', 'left': '10mm', 'right': '10mm'},
                           display_header_footer=True, header_template='<span></span>', footer_template=RODAPE)
    finally:
        await ctx.close()
