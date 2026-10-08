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
      <PageHead title="Inventory" sub="Stock on hand per batch, with recall and expiry flags (FR-3)" />
      <div className="card">
        <div className="card-head">
          <div className="row">
            {over ? (
              <select value={entity} onChange={(e) => { setSkip(0); setEntity(e.target.value); }}>
                <option value="">Choose an entity…</option>
                {(entities || []).map((e) => <option key={e._id} value={e._id}>{e._id} · {e.name}</option>)}
              </select>
            ) : null}
            <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={inStock} onChange={(e) => { setSkip(0); setInStock(e.target.checked); }} /> Only lines with stock</label>
          </div>
          <span className="small muted">{list.data ? `${fmt.num(list.data.total)} line(s)` : ''}</span>
        </div>
        {over && !entity ? <Empty>Select an entity to view its inventory.</Empty> : (
          <Async state={list} empty={(d) => !d.items.length}>
            {(d) => (
              <>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Batch</th><th>Product</th><th className="num">On hand</th><th>Expiry</th><th>Recall</th><th>Stock status</th><th>Updated</th><th /></tr></thead>
                    <tbody>
                      {d.items.map((i) => {
                        const flagged = (i.active_recall && i.active_recall.my_status !== 'returned') || i.is_expired;
                        return (
                          <tr key={i._id} className={flagged ? 'flag' : ''}>
                            <td className="mono">{i.batch_id}</td>
                            <td>{i.product_name}</td>
                            <td className="num">{fmt.num(i.quantity_on_hand)}</td>
                            <td>{fmt.date(i.expiry_date)} {i.is_expired ? <Badge kind="bad">Expired</Badge> : null}</td>
                            <td>{i.active_recall
                              ? <span><Badge kind="bad">{i.active_recall.recall_class}</Badge> <span className="mono small">{i.active_recall.recall_id}</span><div className="small">you: <StatusBadge status={i.active_recall.my_status} /></div></span>
                              : i.batch_status === 'recalled' ? <Badge kind="bad">batch recalled</Badge> : <span className="muted">—</span>}</td>
                            <td><StatusBadge status={i.recall_status === 'none' ? 'active' : i.recall_status} /></td>
                            <td className="small">{fmt.date(i.last_updated)}</td>
                            <td>{i.active_recall ? <button className="btn sm" onClick={() => navigate('recalls', { id: i.active_recall.recall_id })}>Act on recall</button> : null}</td>
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
