const Tokushoho = () => (
  <div className="max-w-3xl mx-auto p-8">
    <h1 className="text-3xl font-bold mb-6">特定商取引法に基づく表記</h1>

    <table className="w-full text-sm border-collapse">
      <tbody>
        {[
          ["販売事業者", "（事業者名を記入）"],
          ["運営責任者", "（責任者名を記入）"],
          ["所在地", "（住所を記入）"],
          ["電話番号", "（電話番号を記入）※請求があれば遅滞なく開示"],
          ["メールアドレス", "support@saronboost.com"],
          ["販売価格", "月額 ¥9,800（税込）"],
          ["商品代金以外の必要料金", "なし（インターネット接続料金等は別途）"],
          ["支払方法", "クレジットカード決済（Stripe）"],
          ["支払時期", "毎月の課金更新日"],
          ["サービス提供時期", "登録完了後、即時利用可能"],
          ["返品・キャンセル", "デジタルサービスの性質上、返金不可。ただしいつでも解約可能。解約後は次回更新日までご利用可能"],
          ["動作環境", "最新版のChrome / Safari / Firefox等のモダンブラウザ"],
        ].map(([k, v]) => (
          <tr key={k} className="border-b">
            <th className="text-left py-3 pr-4 align-top w-1/3 font-semibold">{k}</th>
            <td className="py-3">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>

    <p className="text-xs text-muted-foreground mt-6">
      ※当ページの一部内容（事業者名・所在地等）は、本サービスを正式運用される事業者様にてご記入いただく必要があります。
    </p>
  </div>
);
export default Tokushoho;
