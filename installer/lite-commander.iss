; Inno Setup 6 script for Lite Commander.
; Build with:  ISCC.exe installer\lite-commander.iss  (or npm run installer)
; Expects the release build at src-tauri\target\release\lite-commander.exe

#define AppName "Lite Commander"
#define AppVersion "1.6.0"
#define AppPublisher "Nyingi"
#define AppExe "lite-commander.exe"
#define CliExe "lcmd.exe"

[Setup]
; Stable GUID so upgrades replace the previous install. Do not change it.
AppId={{6E1B7A52-3C0D-4E8B-9F3A-2D5C7B1E4A90}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
OutputDir=output
OutputBaseFilename=LiteCommander-Setup-{#AppVersion}
SetupIconFile=lite-commander.ico
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
Compression=lzma2/ultra
SolidCompression=yes
WizardStyle=modern
ChangesEnvironment=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: unchecked
Name: "editmenu"; Description: "Add &Edit with Lite Commander to the right-click menu of files"; GroupDescription: "Text editor:"
Name: "registermcp"; Description: "Make Lite Commander &discoverable by LLM tools found on this PC (Claude, Cursor, VS Code, ...)"; GroupDescription: "Command line:"

[Files]
Source: "..\src-tauri\target\release\{#AppExe}"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\src-tauri\target\release\{#CliExe}"; DestDir: "{app}"; Flags: ignoreversion
Source: "llm-readme.md"; DestDir: "{app}"; DestName: "README-LLM.md"; Flags: ignoreversion
Source: "lite-commander.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
; Start Menu shortcut (always created)
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"; IconFilename: "{app}\lite-commander.ico"; Comment: "Start and stop your apps' terminals"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; IconFilename: "{app}\lite-commander.ico"; Tasks: desktopicon

[Registry]
; lcmd is always put on the user PATH (unless it is already there), so `lcmd` works in any new terminal
Root: HKCU; Subkey: "Environment"; ValueType: expandsz; ValueName: "Path"; ValueData: "{olddata};{app}"; Check: NeedsAddPath(ExpandConstant('{app}'))

; "Edit with Lite Commander" for every file in Explorer (per user; Windows 11 shows it under "Show more options")
Root: HKCU; Subkey: "Software\Classes\*\shell\LiteCommander.Edit"; ValueType: string; ValueName: ""; ValueData: "Edit with Lite Commander"; Flags: uninsdeletekey; Tasks: editmenu
Root: HKCU; Subkey: "Software\Classes\*\shell\LiteCommander.Edit"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\lite-commander.ico"""; Tasks: editmenu
Root: HKCU; Subkey: "Software\Classes\*\shell\LiteCommander.Edit\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"" --edit ""%1"""; Tasks: editmenu

[Run]
; after a self-update (the app passes /update=1 and has already exited) start it again, as the normal user
Filename: "{app}\{#AppExe}"; Flags: nowait runasoriginaluser; Check: IsUpdateRun
; registers the MCP server in the config of each installed LLM client (merged and backed up, see `lcmd mcp status`)
Filename: "{app}\{#CliExe}"; Parameters: "mcp install"; Flags: runhidden; Tasks: registermcp; StatusMsg: "Registering with LLM tools..."
Filename: "{app}\{#AppExe}"; Description: "Launch {#AppName}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\{#CliExe}"; Parameters: "mcp uninstall"; Flags: runhidden; RunOnceId: "UnregisterMcp"

[UninstallDelete]
; Saved apps live in %APPDATA%\com.litecommander.app and are deliberately kept on uninstall.
Type: filesandordirs; Name: "{app}"

[Code]
function IsUpdateRun(): Boolean;
begin
  Result := ExpandConstant('{param:update|0}') = '1';
end;

function NeedsAddPath(Param: string): Boolean;
var
  OrigPath: string;
begin
  if not RegQueryStringValue(HKCU, 'Environment', 'Path', OrigPath) then
  begin
    Result := True;
    exit;
  end;
  Result := Pos(';' + Lowercase(Param) + ';', ';' + Lowercase(OrigPath) + ';') = 0;
end;

procedure RemoveFromPath(Dir: string);
var
  P, Needle: string;
  I: Integer;
begin
  if not RegQueryStringValue(HKCU, 'Environment', 'Path', P) then exit;
  Needle := ';' + Lowercase(Dir);
  I := Pos(Needle, ';' + Lowercase(P));
  if I > 0 then
  begin
    Delete(P, I, Length(Needle));
    if (Length(P) > 0) and (P[1] = ';') then Delete(P, 1, 1);
    RegWriteExpandStringValue(HKCU, 'Environment', 'Path', P);
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then RemoveFromPath(ExpandConstant('{app}'));
end;

// WebView2 ships with Windows 11 and current Windows 10. Warn (do not block) if it is missing.
function WebView2Installed(): Boolean;
var
  v: String;
begin
  Result :=
    RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', v) or
    RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', v) or
    RegQueryStringValue(HKLM, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', v);
end;

function InitializeSetup(): Boolean;
begin
  Result := True;
  if not WebView2Installed() then
    MsgBox('Microsoft Edge WebView2 Runtime was not found. Lite Commander needs it to show its window.' + #13#10 +
           'Install it from https://developer.microsoft.com/microsoft-edge/webview2/ if the app does not open.',
           mbInformation, MB_OK);
end;
