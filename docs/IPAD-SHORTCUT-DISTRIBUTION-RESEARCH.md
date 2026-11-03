# iPad Shortcuts 配布調査（Windows生成ファイル）

調査日: 2026-11-03（JST）

## 結論

- Windowsで生成した `.shortcut` を、そのままiPad Safariから開いて追加できることは、Appleの公開仕様・一次資料からは確認できない。AppleはShortcutsファイルを配布時に署名・検証する形式として説明しており、未署名ファイルのiPad取り込みを正規の配布経路として文書化していない。このため、Windowsだけで生成した未署名ファイルの取り込み成功を成立済みとは扱わない。
- Appleが案内する配布経路は、Shortcutsアプリから作った **iCloudリンク** または **署名済みファイル**。ファイル共有では「Anyone」または「People Who Know Me」を選ぶとAppleが検証用コピーを受け取る、と明記されている。[Apple Support: Share shortcuts on iPhone or iPad](https://support.apple.com/en-il/guide/shortcuts/-apdf01f8c054/ios)
- iCloudを使わずに本人のiPadだけで正規に用意する最小経路は、iPad上のShortcutsアプリでショートカットを作成・テストし、ファイル共有（Anyone）で書き出す方法。ただし、Windows側で作った未署名バイナリをiPadが受理することの代替証明にはならない。
- Mac/iPad/iCloudのいずれも使わず、WindowsからAppleの正規検証済みショートカットを作って配布する経路は、今回確認したApple一次資料にはない。未知の署名サービスや認証回避は使わない。

## Apple資料から確認できること

### 署名・検証

AppleのWWDC21公式資料は、Shortcutsファイルは送信者の身元で署名され、iCloudリンクと同様にAppleがnotarize（検証）すると説明している。また、再署名用の `shortcuts sign` コマンドラインツールを紹介している。[Apple Developer: Meet Shortcuts for macOS (WWDC21)](https://developer.apple.com/videos/play/wwdc2021/10232/)

AppleのMac User Guideは `shortcuts sign` の実例を掲載し、署名モードを「Anyone」「People Who Know Me」と説明している。[Apple Support: Run shortcuts from the command line on Mac](https://support.apple.com/en-il/guide/shortcuts-mac/-apd455c82f02/mac)

このCLI資料はmacOSのShortcuts command-line toolを前提にしている。Windowsで同等のApple署名を実行できる公式手段は確認できなかった。

### iPadでの正規共有

AppleのiPhone/iPad User Guideは、共有方法として iCloudリンクまたはファイルを案内している。ファイル共有時は「Anyone」なら誰でも実行でき、「People Who Know Me」なら連絡先限定となり、いずれもAppleが検証用コピーを受け取ると記載されている。[Apple Support: Share shortcuts on iPhone or iPad](https://support.apple.com/en-il/guide/shortcuts/-apdf01f8c054/ios)

同じ資料は、受信側がリンクの「Get Shortcut」またはファイルの「Add Shortcut」を押して追加する流れを示している。これはAppleの共有機能から生成されたリンク／ファイルを前提にしており、任意の未署名ファイルの受理を保証する説明ではない。

### 非公開・未信頼ショートカットの注意

Appleは、連絡先などから直接受け取る第三者ショートカットを「untrusted」と扱い、iPadの「設定 > ショートカット > Private Sharing」を有効にする必要がある場合があると説明している。Appleはその真正性や動作を検証できないため、受信したショートカットを確認するよう警告している。[Apple Support: Adjust basic privacy settings in Shortcuts](https://support.apple.com/en-in/guide/shortcuts/apd961a4fc65/ios)

## 最小の本人セットアップ（署名できない場合）

1. iPadのShortcutsアプリで、必要な入力（Safariから共有されるURL）を受け取るショートカットを本人が作る、またはAppleの共有済みショートカットをiPad上で追加する。
2. ショートカットの詳細で **Show in Share Sheet** を有効にする。Appleは、これで他アプリの共有シートから実行できると案内している。[Apple Support: Launch a shortcut from another app](https://support.apple.com/guide/shortcuts/launch-a-shortcut-from-another-app-apd163eb9f95/ios)
3. 入力をURLに限定する。Appleは、URLのみを受け取るショートカットはSafariなどURLを共有するアプリで表示されると説明している。[Apple Support: Understanding input types](https://support.apple.com/en-gb/guide/shortcuts/apd7644168e1/ios)
4. Safariで対象ページを表示し、共有 > ショートカット名を選ぶ。Shortcutsは共有元アプリから渡されたURL等を最初のアクションの入力にする。[Apple Support: Launch a shortcut from another app](https://support.apple.com/guide/shortcuts/launch-a-shortcut-from-another-app-apd163eb9f95/ios)
5. Shortcutsがデータアクセス、Webページ操作、スクリプト実行などを求めた場合は、内容を確認して本人が許可する。JavaScriptを使う場合は「設定 > ショートカット > 詳細 > Allow Running Scripts」が必要で、Appleは信頼できないスクリプトを実行しないよう警告している。[Apple Support: Advanced privacy and security settings](https://support.apple.com/en-au/guide/shortcuts/apdfeb05586f/ios)

この手順は、本人のiPad上での最小セットアップであり、Windowsで生成した未署名 `.shortcut` の自動配布を成立させるものではない。Mortalサイトへのアクセス、実URL、実データ、外部認証回避は調査対象外とした。

## 実装・受け入れ上の扱い

- 「Windowsで `.shortcut` を生成してiPadへ配布」は、署名経路とiPad実機追加テストが確認されるまで **未成立／要検証** とする。
- 署名済みファイルまたはiCloudリンクを使う場合も、Appleの検証後にiPad Safariで「Add Shortcut」が表示されることを実機で確認するまで、配布成功とは報告しない。
- 未署名ファイルの受理を目的に、認証回避、未知の署名サービス、非公式変換ツールは導入しない。
