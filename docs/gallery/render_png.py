import sys, os, subprocess
html = sys.argv[1]; w = sys.argv[2]; h = sys.argv[3]
png = html.replace('.html', '.png')
chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
subprocess.run([chrome, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                "--force-device-scale-factor=2", f"--window-size={w},{h}",
                f"--screenshot={png}", f"file://{os.getcwd()}/{html}"],
               check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
out = subprocess.run(["sips","-g","pixelWidth","-g","pixelHeight",png], capture_output=True, text=True).stdout
sz = os.path.getsize(png)/1e6
print(f"{png}: {' '.join(out.split()[-4:])}  {sz:.2f} MB")
