import { z } from 'zod';
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10)===v,'Invalid date');
const instant = z.string().datetime({offset:true}).nullable();
export const bookingSchema = z.object({
 id:z.string().uuid(), revision:z.number().int().nonnegative(), name:z.string().trim().min(1).max(160), destination:z.string().trim().min(1).max(120), trip:z.string().trim().max(100), platform:z.enum(['Agoda','Airbnb','Booking.com','Direct','Other']), reference:z.string().max(100),
 checkIn:date, checkOut:date, currency:z.enum(['SGD','JPY','USD','EUR','GBP','AUD','MYR','THB','CNY','KRW','HKD']), total:z.number().finite().min(0).max(1e9), paid:z.number().finite().min(0).max(1e9),
 policy:z.enum(['free','nonrefundable','unknown']), cancellationAt:instant, paymentAt:instant, fee:z.number().finite().min(0).max(1e9).nullable(), offset:z.string().regex(/^[+-](?:0\d|1[0-4]):[0-5]\d$/), state:z.enum(['active','cancelled','completed']), url:z.string().max(2000).refine(v=>!v || /^https?:\/\//i.test(v)&&URL.canParse(v),'Use an http or https URL'), notes:z.string().max(2000)
}).refine(v=>v.checkOut>v.checkIn,{message:'Check-out must be after check-in',path:['checkOut']}).refine(v=>v.paid<=v.total,{message:'Paid amount cannot exceed total',path:['paid']}).refine(v=>v.policy!=='free'||!!v.cancellationAt,{message:'Enter the free-cancellation deadline',path:['cancellationAt']}).refine(v=>v.fee===null||v.fee<=v.total,{message:'Cancellation charge cannot exceed total',path:['fee']});
export type Booking=z.infer<typeof bookingSchema>;
export const money=(n:number,c:string)=>new Intl.NumberFormat('en-SG',{style:'currency',currency:c,maximumFractionDigits:c==='JPY'||c==='KRW'?0:2}).format(n);
export function nextDeadline(b:Booking,now=Date.now()){if(b.state!=='active')return null;const a:{at:string;kind:string}[]=[];if(b.policy==='free'&&b.cancellationAt&&Date.parse(b.cancellationAt)>now)a.push({at:b.cancellationAt,kind:'Free cancellation ends'});if(b.paymentAt&&b.paid<b.total)a.push({at:b.paymentAt,kind:'Payment due'});return a.sort((x,y)=>Date.parse(x.at)-Date.parse(y.at))[0]||null;}
export function status(b:Booking,now=Date.now()){if(b.state==='cancelled')return 'Cancelled';if(b.state==='completed')return 'Completed';if(b.policy==='unknown')return 'Needs verification';if(b.policy==='nonrefundable'||b.cancellationAt&&Date.parse(b.cancellationAt)<=now)return 'Non-refundable';if(b.cancellationAt&&Date.parse(b.cancellationAt)-now<=3*864e5)return 'Expiring soon';return 'Free cancellation';}
export function countdown(at:string,now:number){const n=Date.parse(at)-now;if(n<=0)return 'Overdue';const h=Math.ceil(n/36e5);return h>=24?`${Math.floor(h/24)}d ${h%24}h left`:`${h}h left`;}
export function currentFee(b:Booking,now:number){if(b.state!=='active')return 0;if(b.policy==='unknown')return null;if(b.policy==='free'&&b.cancellationAt&&Date.parse(b.cancellationAt)>now)return 0;return b.fee;}
export function calendar(bookings: Booking[], now = Date.now()) {
    const escape = (value: string) =>
      value
        .replace(/\\/g, '\\\\')
        .replace(/\r\n|\r|\n/g, '\\n')
        .replace(/[,;]/g, '\\$&');
  
    const stamp = (value: string | number) =>
      new Date(value)
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}/, '');
  
    // Calendar lines must be folded at 75 UTF-8 bytes.
    const fold = (line: string) => {
      const encoder = new TextEncoder();
      let result = '';
      let bytes = 0;
  
      for (const character of line) {
        const size = encoder.encode(character).length;
  
        if (bytes + size > 75) {
          result += '\r\n ';
          bytes = 1;
        }
  
        result += character;
        bytes += size;
      }
  
      return result;
    };
  
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Allthatbook//Booking Deadlines//EN',
      'CALSCALE:GREGORIAN',
      'X-WR-CALNAME:Allthatbook deadlines',
    ];
  
    for (const booking of bookings) {
      if (booking.state !== 'active') continue;
  
      const deadlines: [string | null, string][] = [
        [
          booking.policy === 'free' ? booking.cancellationAt : null,
          'Cancellation deadline',
        ],
        [
          booking.paid < booking.total ? booking.paymentAt : null,
          'Payment due',
        ],
      ];
  
      for (const [at, label] of deadlines) {
        if (!at) continue;
  
        const deadline = Date.parse(at);
        if (!Number.isFinite(deadline) || deadline <= now) continue;
  
        const description = [
          label === 'Cancellation deadline'
            ? 'Free cancellation ends at this time. Cancel through your booking provider before the deadline.'
            : 'Payment is due at this time. Check the booking provider for payment instructions or automatic charges.',
          `Booking platform: ${booking.platform}.`,
          `Deadline recorded: ${at}.`,
          'Check the exact deadline against your booking confirmation.',
          'This exported event does not automatically update when you change your booking in Allthatbook.',
        ].join('\n');
  
        lines.push(
          'BEGIN:VEVENT',
          `UID:${booking.id}-${label.replace(/ /g, '')}@stayola`,
          `SEQUENCE:${booking.revision}`,
          `DTSTAMP:${stamp(now)}`,
          `DTSTART:${stamp(deadline)}`,
          `DTEND:${stamp(deadline + 15 * 60 * 1000)}`,
          `SUMMARY:${escape(`${label} — ${booking.name}`)}`,
          `LOCATION:${escape(booking.destination)}`,
          `DESCRIPTION:${escape(description)}`,
          'TRANSP:TRANSPARENT',
        );
  
        for (const days of [7, 3, 1]) {
          // Don't request notifications for times already past.
          if (deadline - days * 24 * 60 * 60 * 1000 <= now) continue;
  
          lines.push(
            'BEGIN:VALARM',
            `TRIGGER:-P${days}D`,
            'ACTION:DISPLAY',
            `DESCRIPTION:${escape(
              `${label} in ${days} ${days === 1 ? 'day' : 'days'} — ${booking.name}`,
            )}`,
            'END:VALARM',
          );
        }
  
        lines.push('END:VEVENT');
      }
    }
  
    lines.push('END:VCALENDAR');
    return lines.map(fold).join('\r\n') + '\r\n';
  }
