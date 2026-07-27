import sys, pathlib, subprocess, os
src = sys.argv[1]
built = src.replace('.html', '.built.html')
html = pathlib.Path(src).read_text()
for token, path in [('<!--FIG_NULL-->','fig-null.svg'),
                    ('<!--FIG_DECORR-->','fig-decorrelation.svg'),
                    ('<!--FIG_COST-->','fig-cost.svg'),
                    ('<!--FIG_ARCH-->','fig-architectures.svg')]:
    if token in html:
        html = html.replace(token, pathlib.Path(path).read_text())
pathlib.Path(built).write_text(html)
pdf = src.replace('.html', '.pdf')
chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
subprocess.run([chrome, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                f"--print-to-pdf={pdf}", f"file://{os.getcwd()}/{built}"], check=True,
               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print("rendered", pdf)
