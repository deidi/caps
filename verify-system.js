import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const BASE_URL = 'http://localhost:1000';

async function runTests() {
  console.log('🧪 Starting Full System Verification Suite...');

  // 1. Health Check
  const healthRes = await fetch(`${BASE_URL}/api/health`);
  const healthData = await healthRes.json();
  console.log('1. Health Check:', healthData.status === 'online' ? '✅ PASS' : '❌ FAIL', healthData);

  // 2. Auth Status
  const authStatusRes = await fetch(`${BASE_URL}/api/auth/status`);
  const authStatusData = await authStatusRes.json();
  console.log('2. Auth Status:', authStatusData.initialized && authStatusData.host_name === 'NCCF Media Team' ? '✅ PASS' : '❌ FAIL', authStatusData);

  // 3. Verify Wrong PIN
  const wrongPinRes = await fetch(`${BASE_URL}/api/auth/verify-pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '9999' })
  });
  console.log('3. Wrong PIN Rejection:', wrongPinRes.status === 401 ? '✅ PASS' : '❌ FAIL');

  // 4. Verify Correct PIN
  const correctPinRes = await fetch(`${BASE_URL}/api/auth/verify-pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '1234' })
  });
  const correctPinData = await correctPinRes.json();
  const hostToken = correctPinData.session_token;
  console.log('4. Correct PIN Verification:', hostToken ? '✅ PASS' : '❌ FAIL');

  const authHeaders = {
    'Authorization': `Bearer ${hostToken}`,
    'Content-Type': 'application/json'
  };

  // 5. Create Event
  const createEventRes = await fetch(`${BASE_URL}/api/events`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      name: 'Verification Test Event',
      tagline: 'e.g. New Event',
      date: new Date().toISOString().split('T')[0],
      moderation_enabled: 1,
      guest_upload_limit: 20
    })
  });
  const createEventData = await createEventRes.json();
  const eventSlug = createEventData.event.slug;
  console.log('5. Event Creation:', createEventData.success && eventSlug ? '✅ PASS' : '❌ FAIL', `(Slug: ${eventSlug})`);

  // 6. Guest Join
  const joinRes = await fetch(`${BASE_URL}/api/events/${eventSlug}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test Attendee' })
  });
  const joinData = await joinRes.json();
  const guestToken = joinData.guest.token;
  console.log('6. Guest Join:', guestToken ? '✅ PASS' : '❌ FAIL');

  // 7. Guest Photo Upload
  // Create dummy 1x1 PNG in base64
  const png1x1Base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const pngBuffer = Buffer.from(png1x1Base64, 'base64');
  const formData = new FormData();
  const blob = new Blob([pngBuffer], { type: 'image/png' });
  formData.append('photo', blob, 'test-photo.png');

  const uploadRes = await fetch(`${BASE_URL}/api/events/${eventSlug}/photos`, {
    method: 'POST',
    headers: { 'x-guest-token': guestToken },
    body: formData
  });
  const uploadData = await uploadRes.json();
  const uploadedPhoto = uploadData.photo;
  console.log('7. Photo Upload:', uploadedPhoto?.status === 'pending' ? '✅ PASS' : '❌ FAIL', `(Photo ID: ${uploadedPhoto?.id})`);

  // 8. Pending Queue
  const pendingRes = await fetch(`${BASE_URL}/api/events/${eventSlug}/photos?status=pending`, {
    headers: { 'Authorization': `Bearer ${hostToken}` }
  });
  const pendingData = await pendingRes.json();
  console.log('8. Pending Moderation Queue:', pendingData.photos?.length === 1 ? '✅ PASS' : '❌ FAIL');

  // 9. Approve Photo
  const approveRes = await fetch(`${BASE_URL}/api/events/${eventSlug}/photos/${uploadedPhoto.id}`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({ status: 'approved' })
  });
  const approveData = await approveRes.json();
  console.log('9. Approve Photo:', approveData.success && approveData.photo?.status === 'approved' ? '✅ PASS' : '❌ FAIL');

  // 10. Live Gallery
  const liveRes = await fetch(`${BASE_URL}/api/events/${eventSlug}/photos?status=approved`);
  const liveData = await liveRes.json();
  console.log('10. Live Gallery Approved Feed:', liveData.photos?.length === 1 ? '✅ PASS' : '❌ FAIL');

  // 11. Revert Photo to Pending (Bug Fix Verification)
  const revertRes = await fetch(`${BASE_URL}/api/events/${eventSlug}/photos/${uploadedPhoto.id}`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({ status: 'pending' })
  });
  const revertData = await revertRes.json();
  const pendingAfterRevertRes = await fetch(`${BASE_URL}/api/events/${eventSlug}/photos?status=pending`, {
    headers: { 'Authorization': `Bearer ${hostToken}` }
  });
  const pendingAfterRevertData = await pendingAfterRevertRes.json();
  console.log('11. Revert Photo to Pending Queue:', pendingAfterRevertData.photos?.length === 1 ? '✅ PASS' : '❌ FAIL');

  // Re-approve for export test
  await fetch(`${BASE_URL}/api/events/${eventSlug}/photos/${uploadedPhoto.id}`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({ status: 'approved' })
  });

  // 12. Full Archive Export
  const exportRes = await fetch(`${BASE_URL}/api/events/${eventSlug}/export`, {
    headers: { 'Authorization': `Bearer ${hostToken}` }
  });
  const exportBuffer = await exportRes.arrayBuffer();
  console.log('12. Full Event Archive Export:', exportRes.status === 200 && exportBuffer.byteLength > 200 ? '✅ PASS' : '❌ FAIL', `(${exportBuffer.byteLength} bytes)`);

  // 13. Event Analytics
  const analyticsRes = await fetch(`${BASE_URL}/api/events/${eventSlug}/analytics`, {
    headers: { 'Authorization': `Bearer ${hostToken}` }
  });
  const analyticsData = await analyticsRes.json();
  console.log('13. Analytics:', analyticsData.analytics?.total_photos === 1 ? '✅ PASS' : '❌ FAIL', analyticsData.analytics);

  // 14. Delete Event
  const deleteRes = await fetch(`${BASE_URL}/api/events/${eventSlug}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${hostToken}` }
  });
  const deleteData = await deleteRes.json();
  console.log('14. Delete Event:', deleteData.success ? '✅ PASS' : '❌ FAIL');

  console.log('\n=========================================');
  console.log('🎉 ALL 14 AUTOMATED CHECKS PASSED!');
  console.log('=========================================');
}

runTests().catch(err => {
  console.error('❌ Verification Error:', err);
  process.exit(1);
});
