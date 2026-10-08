function Inventory() {
  const { user } = useAuth();
  const over = isOversight(user);
  const [entity, setEntity] = useState('');
  const [inStock, setInStock] = useState(true);
  const [skip, setSkip] = useState(0);
  const list = useApi(over && !entity ? null : '/inventory', { query: { entity_id: over ? entity : undefined, in_stock: inStock ? 'true' : undefined, skip, limit: 50 } });
  const entities = useEntities(over ? null : false);

  return (
    <div className="stack">
      <PageHead title={over ? 'Stock' : 'My stock'} help="inventory" sub={over ? 'What any company holds right now.' : 'What you hold right now, batch by batch.'} />
      <div className="card">
        <div className="card-head">
          <div className="row">
            {over ? (
              <select value={entity} onChange={(e) => { setSkip(0); setEntity(e.target.value); }}>
                <option value="">Choose a company…</option>
                {(entities || []).map((e) => <option key={e._id} value={e._id}>{e._id} · {e.name}</option>)}
              </select>
            ) : null}
            <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={inStock} onChange={(e) => { setSkip(0); setInStock(e.target.checked); }} /> Hide batches with nothing left</label>
          </div>
          <span className="small muted">{list.data ? `${fmt.num(list.data.total)} ${list.data.total === 1 ? 'batch' : 'batches'}` : ''}</span>
        </div>
        {over && !entity ? <Empty>Choose a company above to see what it holds.</Empty> : (
          <Async state={list} empty={(d) => !d.items.length}>
            {(d) => (
              <>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Medicine</th><th className="num">Units held</th><th>Expires</th><th>Can it be sold?</th><th /></tr></thead>
                    <tbody>
                      {d.items.map((i) => {
                        const flagged = (i.active_recall && i.active_recall.my_status !== 'returned') || i.is_expired;
                        return (
                          <tr key={i._id} className={flagged ? 'flag' : ''}>
                            <td><b>{i.product_name}</b><div className="id-code">{i.batch_id}</div></td>
                            <td className="num">{fmt.num(i.quantity_on_hand)}</td>
                            <td>{fmt.date(i.expiry_date)} </td>
                            <td>{i.active_recall
                              ? <span><Badge kind="bad">No: recalled</Badge><div className="small">your response: <StatusBadge status={i.active_recall.my_status} /></div></span>
                              : i.batch_status === 'recalled' ? <Badge kind="bad">No: recalled</Badge>
                                : i.is_expired ? <Badge kind="bad">No: expired</Badge>
                                  : i.recall_status !== 'none' ? <StatusBadge status={i.recall_status} /> : <Badge kind="ok">Yes</Badge>}</td>
                            <td>{i.active_recall ? <button className="btn sm" onClick={() => navigate('recalls', { id: i.active_recall.recall_id })}>Respond to recall</button> : null}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <Pager total={d.total} limit={d.limit} skip={d.skip} onChange={setSkip} />
              </>
            )}
          </Async>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { Inventory });
