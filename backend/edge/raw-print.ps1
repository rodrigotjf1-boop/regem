# Envia bytes CRUS (ESC/POS) para uma impressora instalada no Windows, pelo NOME,
# usando o spooler em modo RAW (winspool WritePrinter). NAO usa GDI/Out-Printer, entao
# os comandos ESC/POS (negrito, fonte dupla, corte) chegam intactos a impressora.
# Uso: powershell -File raw-print.ps1 -PrinterName "EPSON TM-T20" -FilePath C:\...\job.bin
param(
  [Parameter(Mandatory = $true)][string]$PrinterName,
  [Parameter(Mandatory = $true)][string]$FilePath
)
$ErrorActionPreference = 'Stop'
$bytes = [System.IO.File]::ReadAllBytes($FilePath)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class RegemRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool OpenPrinter(string src, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, ref DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);

  public static void Send(string printer, byte[] data) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero))
      throw new Exception("OpenPrinter falhou (impressora '" + printer + "' nao encontrada?): " + Marshal.GetLastWin32Error());
    try {
      DOCINFO di = new DOCINFO();
      di.pDocName = "Regem";
      di.pDataType = "RAW";
      if (!StartDocPrinter(h, 1, ref di)) throw new Exception("StartDocPrinter falhou: " + Marshal.GetLastWin32Error());
      try {
        if (!StartPagePrinter(h)) throw new Exception("StartPagePrinter falhou: " + Marshal.GetLastWin32Error());
        int written;
        if (!WritePrinter(h, data, data.Length, out written)) throw new Exception("WritePrinter falhou: " + Marshal.GetLastWin32Error());
        EndPagePrinter(h);
      } finally {
        EndDocPrinter(h);
      }
    } finally {
      ClosePrinter(h);
    }
  }
}
"@

[RegemRawPrinter]::Send($PrinterName, $bytes)
