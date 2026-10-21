; Keep the assisted installer, with a supported nsDialogs directory page for a visible app subfolder.
!include MUI2.nsh
!include FileFunc.nsh
!include nsDialogs.nsh

!ifndef BUILD_UNINSTALLER
  !insertmacro MUI_DIRECTORYPAGE_INTERFACE
  Var qianxiDefaultDirectory
  Var qianxiPreviousUserDirectory
  Var qianxiPreviousMachineDirectory
  Var qianxiDirectoryShown
  Var qianxiDirectoryCandidate
  Var qianxiDirectoryStableTicks

  !macro customInit
    ReadRegStr $qianxiPreviousUserDirectory HKCU "Software\${APP_GUID}" InstallLocation
    ReadRegStr $qianxiPreviousMachineDirectory HKLM "Software\${APP_GUID}" InstallLocation
    ; initMultiUser has already restored existing installs and /D. Only new installs get a default.
    ; /currentuser and /allusers also set the builder's installation flags on fresh installs.
    ; Actual registry paths, rather than those mode flags, identify an existing install.
    ${If} $qianxiPreviousUserDirectory == ""
    ${AndIf} $qianxiPreviousMachineDirectory == ""
      !insertmacro GetDParameter $R0
      ${If} $R0 == ""
        IfFileExists "D:\*.*" 0 +3
          StrCpy $qianxiDefaultDirectory "D:\QianXiAccounts"
          Goto +2
        StrCpy $qianxiDefaultDirectory "C:\QianXiAccounts"
        StrCpy $INSTDIR $qianxiDefaultDirectory
      ${EndIf}
    ${EndIf}
  !macroend

  Function QianXiNormalizeDirectory
    Push $0
    Push $1
    ; Preserve a previous custom install directory, including on upgrade.
    ${If} $INSTDIR == $qianxiPreviousUserDirectory
    ${AndIf} $INSTDIR != ""
      Goto qianxi_directory_done
    ${EndIf}
    ${If} $INSTDIR == $qianxiPreviousMachineDirectory
    ${AndIf} $INSTDIR != ""
      Goto qianxi_directory_done
    ${EndIf}
    ${If} $INSTDIR == ""
      Goto qianxi_directory_done
    ${EndIf}
    System::Call 'shlwapi::PathIsRelativeW(w "$INSTDIR") i .r0'
    ${If} $0 != 0
      Goto qianxi_directory_done
    ${EndIf}
    StrCpy $1 $INSTDIR
    qianxi_trim_directory:
      StrCpy $0 $1 1 -1
      ${If} $0 == "\"
        StrCpy $1 $1 -1
        Goto qianxi_trim_directory
      ${EndIf}
    ${GetFileName} "$1" $0
    ${If} $0 != "QianXiAccounts"
      StrCpy $INSTDIR "$1\QianXiAccounts"
    ${Else}
      StrCpy $INSTDIR $1
    ${EndIf}
    qianxi_directory_done:
    Pop $1
    Pop $0
  FunctionEnd

  Function QianXiDirectoryShow
    ; The install-mode page can reassign INSTDIR after customInit. Apply the new-install default once.
    ${If} $qianxiDirectoryShown != "1"
    ${AndIf} $qianxiDefaultDirectory != ""
      StrCpy $INSTDIR $qianxiDefaultDirectory
    ${EndIf}
    StrCpy $qianxiDirectoryShown "1"
    Call QianXiNormalizeDirectory
    nsDialogs::Create 1018
    Pop $mui.DirectoryPage
    ${If} $mui.DirectoryPage == error
      Abort
    ${EndIf}
    ${NSD_CreateLabel} 0u 0u 100% 42u "Setup 将安装 千禧accounts 到下列文件夹。选择盘符或父文件夹后会自动补上 QianXiAccounts 子文件夹。单击 [安装] 开始安装。"
    Pop $mui.DirectoryPage.Text
    ${NSD_CreateGroupBox} 0u 48u 100% 48u "目标文件夹"
    Pop $mui.DirectoryPage.DirectoryBox
    ${NSD_CreateText} 8u 66u 72% 14u "$INSTDIR"
    Pop $mui.DirectoryPage.Directory
    System::Call 'user32::SetWindowLongW(p $mui.DirectoryPage.Directory, i -12, i 1019)'
    ${NSD_CreateButton} 78% 65u 20% 16u "浏览(&B)..."
    Pop $mui.DirectoryPage.BrowseButton
    System::Call 'user32::SetWindowLongW(p $mui.DirectoryPage.BrowseButton, i -12, i 1001)'
    ${NSD_OnClick} $mui.DirectoryPage.BrowseButton QianXiDirectoryBrowse
    SectionGetSize 0 $0
    ${NSD_CreateLabel} 0u 109u 100% 12u "所需空间：$0 KB"
    Pop $mui.DirectoryPage.SpaceRequired
    ${NSD_CreateLabel} 0u 123u 100% 12u ""
    Pop $mui.DirectoryPage.SpaceAvailable
    Call QianXiDirectorySpace
    GetDlgItem $0 $HWNDPARENT 1
    SendMessage $0 ${WM_SETTEXT} 0 "STR:$(^InstallBtn)"
    StrCpy $qianxiDirectoryCandidate $INSTDIR
    StrCpy $qianxiDirectoryStableTicks 0
    ${NSD_CreateTimer} QianXiDirectoryTimer 200
    ; nsDialogs timers must run inside the dialog's own Show loop.
    nsDialogs::Show
    ${NSD_KillTimer} QianXiDirectoryTimer
  FunctionEnd

  Function QianXiDirectoryBrowse
    Pop $0
    ${NSD_GetText} $mui.DirectoryPage.Directory $INSTDIR
    nsDialogs::SelectFolderDialog "选择安装位置" "$INSTDIR"
    Pop $0
    ${If} $0 != error
      StrCpy $INSTDIR $0
      Call QianXiNormalizeDirectory
      ${NSD_SetText} $mui.DirectoryPage.Directory $INSTDIR
      Call QianXiDirectorySpace
    ${EndIf}
  FunctionEnd

  Function QianXiDirectorySpace
    Push $0
    Push $1
    ${GetRoot} "$INSTDIR" $1
    System::Call 'kernel32::GetDiskFreeSpaceExW(w "$1\", *l .r0, p 0, p 0) i .r1'
    ${If} $1 != 0
      System::Int64Op $0 / 1048576
      Pop $0
      ${NSD_SetText} $mui.DirectoryPage.SpaceAvailable "可用空间：$0 MB"
    ${Else}
      ${NSD_SetText} $mui.DirectoryPage.SpaceAvailable "请确认所选磁盘可以访问。"
    ${EndIf}
    Pop $1
    Pop $0
  FunctionEnd

  Function QianXiDirectoryTimer
    Push $0
    Push $1
    ; Keep normalization active across temporary page hiding/minimization; Show owns timer lifetime.
    ; Do not modify a partially typed path or an open Browse dialog.
    System::Call 'user32::GetFocus() p .r0'
    ${If} $0 == $mui.DirectoryPage.Directory
      Goto qianxi_timer_done
    ${EndIf}
    System::Call 'user32::IsWindowEnabled(p $HWNDPARENT) i .r0'
    ${If} $0 == 0
      Goto qianxi_timer_done
    ${EndIf}
    ${NSD_GetText} $mui.DirectoryPage.Directory $0
    ${If} $0 != $qianxiDirectoryCandidate
      StrCpy $qianxiDirectoryCandidate $0
      StrCpy $qianxiDirectoryStableTicks 0
      Goto qianxi_timer_done
    ${EndIf}
    IntOp $qianxiDirectoryStableTicks $qianxiDirectoryStableTicks + 1
    ${If} $qianxiDirectoryStableTicks < 2
      Goto qianxi_timer_done
    ${EndIf}
    StrCpy $INSTDIR $0
    Call QianXiNormalizeDirectory
    ${If} $INSTDIR != $0
      SendMessage $mui.DirectoryPage.Directory ${WM_SETTEXT} 0 "STR:$INSTDIR"
      StrCpy $qianxiDirectoryCandidate $INSTDIR
      Call QianXiDirectorySpace
    ${EndIf}
    qianxi_timer_done:
    Pop $1
    Pop $0
  FunctionEnd

  Function QianXiDirectoryLeave
    ${NSD_KillTimer} QianXiDirectoryTimer
    ${NSD_GetText} $mui.DirectoryPage.Directory $INSTDIR
    Call QianXiNormalizeDirectory
    SendMessage $mui.DirectoryPage.Directory ${WM_SETTEXT} 0 "STR:$INSTDIR"
    System::Call 'shlwapi::PathIsRelativeW(w "$INSTDIR") i .r0'
    ${If} $INSTDIR == ""
    ${OrIf} $0 != 0
      MessageBox MB_OK|MB_ICONEXCLAMATION "请选择完整的安装路径。"
      ${NSD_CreateTimer} QianXiDirectoryTimer 200
      Abort
    ${EndIf}
    ${GetRoot} "$INSTDIR" $0
    IfFileExists "$0\*.*" qianxi_drive_valid
      MessageBox MB_OK|MB_ICONEXCLAMATION "无法访问所选磁盘，请重新选择安装位置。"
      ${NSD_CreateTimer} QianXiDirectoryTimer 200
      Abort
    qianxi_drive_valid:
    System::Call 'kernel32::GetFileAttributesW(w "$INSTDIR") i .r0'
    ${If} $0 != -1
      IntOp $0 $0 & 16
      ${If} $0 == 0
        MessageBox MB_OK|MB_ICONEXCLAMATION "此路径已存在同名文件，请选择其他安装位置。"
        ${NSD_CreateTimer} QianXiDirectoryTimer 200
        Abort
      ${EndIf}
    ${EndIf}
  FunctionEnd

  ; Preserve the builder's PRE callback (including skipping this page on automatic updates).
  !macroundef MUI_PAGE_DIRECTORY
  !macro MUI_PAGE_DIRECTORY
    !insertmacro MUI_PAGE_INIT
    !insertmacro MUI_SET MUI_DIRECTORYPAGE ""
    Function QianXiDirectoryCreate
      !insertmacro MUI_PAGE_FUNCTION_CUSTOM PRE
      !insertmacro MUI_HEADER_TEXT "$(MUI_TEXT_DIRECTORY_TITLE)" "$(MUI_TEXT_DIRECTORY_SUBTITLE)"
      Call QianXiDirectoryShow
    FunctionEnd
    PageEx custom
      PageCallbacks QianXiDirectoryCreate QianXiDirectoryLeave
      Caption " "
    PageExEnd
  !macroend
!endif
