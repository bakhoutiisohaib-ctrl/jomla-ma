import {latestRecord} from './useBuyerWorkspace';

test('late reads cannot roll a saved decision or completed revision backwards',()=>{
  const pending={_id:'r',status:'deciding',revision:3,decision:{phase:'pending'}};
  expect(latestRecord(pending,{_id:'r',status:'responded',revision:2})).toBe(pending);
  expect(latestRecord(pending,{_id:'r',status:'responded'})).toBe(pending);
  const completed={...pending,status:'accepted',revision:4,decision:{phase:'completed'}};
  expect(latestRecord(completed,pending)).toBe(completed);
  expect(latestRecord(pending,completed)).toBe(completed);
});
