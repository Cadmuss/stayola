import {supabase} from './supabase';
import {bookingSchema,type Booking} from './bookings';
function client(){if(!supabase)throw Error('Configure Supabase in .env.local first.');return supabase;}
export async function listBookings():Promise<Booking[]>{const {data,error}=await client().from('bookings').select('*');if(error)throw Error(error.message);return (data??[]).map(row=>bookingSchema.parse(row));}
export async function saveBooking(input:Booking):Promise<Booking>{const b=bookingSchema.parse(input);const db=client();let result;
if(b.revision===0){const {data:{user},error}=await db.auth.getUser();if(error||!user)throw Error('Please sign in again.');result=await db.from('bookings').insert({...b,user_id:user.id,revision:1}).select().single();}
else{result=await db.from('bookings').update({...b,revision:b.revision+1}).eq('id',b.id).eq('revision',b.revision).select().maybeSingle();}
if(result.error)throw Error(result.error.message);if(!result.data)throw Error('This booking changed or was deleted. Reload before editing.');return bookingSchema.parse(result.data);}
export async function deleteBooking(b:Booking){const {data,error}=await client().from('bookings').delete().eq('id',b.id).eq('revision',b.revision).select('id');if(error)throw Error(error.message);if(!data?.length)throw Error('This booking changed or was removed. Reload the page.');}
