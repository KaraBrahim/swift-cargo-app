# Send a file of raw bytes straight to a Windows printer queue.
#
# Why this exists: a thermal printer speaks ESC/POS, not GDI. Anything that goes
# through the normal Windows print path (Out-Printer, a browser's print dialog,
# the printer's own driver) rasterises the page and the ESC/POS commands come
# out as literal garbage on the paper. The spooler will pass bytes through
# untouched only when the job is submitted with datatype RAW, and the only way
# to ask for that is the winspool API below.
#
# The alternative — sharing the printer and doing `copy /b file \\host\share` —
# needs the printer to be shared and file/printer sharing enabled, which is a
# lot to ask of a desk in Chine or Algérie. This works with a plain local USB
# printer, no sharing.
param(
  [Parameter(Mandatory = $true)][string]$PrinterName,
  [Parameter(Mandatory = $true)][string]$FilePath,
  [string]$DocName = 'Swift Cargo'
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;

public static class SwiftCargoRawPrint
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DOCINFO
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPWStr)] string src, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true)]
    private static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO di);

    [DllImport("winspool.drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true)]
    private static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true)]
    private static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true)]
    private static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true)]
    private static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

    private static void Fail(string what)
    {
        throw new Exception(what + " a echoue (code Windows " + Marshal.GetLastWin32Error() + ")");
    }

    public static int SendFile(string printerName, string filePath, string docName)
    {
        byte[] bytes = File.ReadAllBytes(filePath);
        IntPtr hPrinter;
        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) Fail("OpenPrinter");
        try
        {
            DOCINFO di = new DOCINFO();
            di.pDocName = docName;
            di.pDataType = "RAW";
            if (!StartDocPrinter(hPrinter, 1, di)) Fail("StartDocPrinter");
            try
            {
                if (!StartPagePrinter(hPrinter)) Fail("StartPagePrinter");
                IntPtr buf = Marshal.AllocCoTaskMem(bytes.Length);
                try
                {
                    Marshal.Copy(bytes, 0, buf, bytes.Length);
                    int written;
                    if (!WritePrinter(hPrinter, buf, bytes.Length, out written)) Fail("WritePrinter");
                    EndPagePrinter(hPrinter);
                    return written;
                }
                finally { Marshal.FreeCoTaskMem(buf); }
            }
            finally { EndDocPrinter(hPrinter); }
        }
        finally { ClosePrinter(hPrinter); }
    }
}
'@

$written = [SwiftCargoRawPrint]::SendFile($PrinterName, $FilePath, $DocName)
Write-Output "OK $written"
