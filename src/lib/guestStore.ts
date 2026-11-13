import {bookingSchema,type Booking} from './bookings';
const KEY='stayola-guest-bookings-v1';
export function listGuestBookings():Booking[]{try{const raw=localStorage.getItem(KEY);if(!raw)return [];const arr=JSON.parse(raw);if(!Array.isArray(arr))return [];return arr.flatMap(x=>{const p=bookingSchema.safeParse(x);return p.success?[p.data]:[]});}catch{return [];}}
function write(list:Booking[]){localStorage.setItem(KEY,JSON.stringify(list));}
export function saveGuestBooking(input:Booking):Booking{const b=bookingSchema.parse(input);const list=listGuestBookings();write(list.some(x=>x.id===b.id)?list.map(x=>x.id===b.id?b:x):[...list,b]);return b;}
export function deleteGuestBooking(id:string){write(listGuestBookings().filter(x=>x.id!==id));}