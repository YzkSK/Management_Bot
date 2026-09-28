# assets/emojis(Discordダークテーマ向け)から、Dashboardライトモード向けの黒版をassets/emojis-lightに生成する。
# 無彩色の画素だけ明暗反転し、色付きバッジ(緑/赤/黄)はそのまま残す。
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class LightEmoji {
  public static void Convert(string src, string dst) {
    using (var bmp = new Bitmap(src)) {
      var rect = new Rectangle(0, 0, bmp.Width, bmp.Height);
      var data = bmp.LockBits(rect, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
      var buf = new byte[data.Stride * bmp.Height];
      Marshal.Copy(data.Scan0, buf, 0, buf.Length);
      for (int i = 0; i < buf.Length; i += 4) {
        int b = buf[i], g = buf[i + 1], r = buf[i + 2];
        if (System.Math.Max(r, System.Math.Max(g, b)) - System.Math.Min(r, System.Math.Min(g, b)) >= 40) continue;
        buf[i] = (byte)(255 - b); buf[i + 1] = (byte)(255 - g); buf[i + 2] = (byte)(255 - r);
      }
      Marshal.Copy(buf, 0, data.Scan0, buf.Length);
      bmp.UnlockBits(data);
      bmp.Save(dst, ImageFormat.Png);
    }
  }
}
'@
$root = Split-Path $PSScriptRoot
$out = Join-Path $root "assets/emojis-light"
New-Item -ItemType Directory -Force $out | Out-Null
Get-ChildItem (Join-Path $root "assets/emojis") -Filter *.png | ForEach-Object {
  [LightEmoji]::Convert($_.FullName, (Join-Path $out $_.Name))
}
