import sys, pathlib, subprocess, os
src = sys.argv[1]              # e.g. poster-landscape.html
built = src.replace('.html', '.built.html')
html = pathlib.Path(src).read_text()
html = html.replace('<!--FIG_NULL-->', pathlib.Path('fig-null.svg').read_text())
html = html.replace('<!--FIG_DECORR-->', pathlib.Path('fig-decorrelation.svg').read_text())
pathlib.Path(built).write_text(html)
pdf = src.replace('.html', '.pdf')
chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
subprocess.run([chrome, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                f"--print-to-pdf={pdf}", f"file://{os.getcwd()}/{built}"], check=True,
               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print("rendered", pdf)
