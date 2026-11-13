import assert from 'node:assert/strict';
import { bookingSchema, nextDeadline, currentFee, status, calendar } from '../src/lib/bookings.ts';
const now=Date.parse('2026-11-09T12:00:00Z');
const b=bookingSchema.parse({id:'00000000-0000-4000-8000-000000000001',revision:0,name:'Test hotel',destination:'Tokyo',trip:'Japan',platform:'Agoda',reference:'',checkIn:'2026-12-03',checkOut:'2026-12-06',currency:'JPY',total:30000,paid:10000,policy:'free',cancellationAt:'2026-11-10T21:00:00+09:00',paymentAt:'2026-11-12T12:00:00+09:00',fee:15000,offset:'+09:00',state:'active',url:'',notes:''});
assert.equal(nextDeadline(b,now)?.kind,'Free cancellation ends');
assert.equal(currentFee(b,now),0);
assert.equal(currentFee(b,now+2*864e5),15000);
assert.equal(status(b,now),'Expiring soon');
assert.equal(status(b,now+2*864e5),'Non-refundable');
assert.equal(nextDeadline({...b,paid:b.total},now+2*864e5),null);
assert.equal(nextDeadline({...b,state:'cancelled'},now),null);
assert.equal(currentFee({...b,policy:'unknown'},now),null);
assert.equal(bookingSchema.safeParse({...b,paid:30001}).success,false);
assert.equal(bookingSchema.safeParse({...b,checkOut:b.checkIn}).success,false);
assert.equal(bookingSchema.safeParse({...b,checkIn:'2026-02-30'}).success,false);
assert.equal(bookingSchema.safeParse({...b,url:'javascript:alert(1)'}).success,false);
assert.equal(bookingSchema.safeParse({...b,cancellationAt:null}).success,false);
assert.ok(calendar([b], now).includes('DTSTART:20261110T120000Z'));
assert.ok(calendar([b], now).includes('TRIGGER:-P1D'));
assert.ok(
  !calendar([{ ...b, state: 'cancelled' }], now).includes('BEGIN:VEVENT')
);
console.log('15 booking, timezone, validation and calendar checks passed.');
