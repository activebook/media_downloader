// Test script for bilibili BV extraction and API call
function testBvExtraction() {
  const testUrls = [
    'https://www.bilibili.com/video/BV1zGMJzsExz',
    'https://www.bilibili.com/video/BV1zGMJzsExz?xxx=yyyyy',
    'https://www.bilibili.com/video/BV1234567890/',
    'https://www.bilibili.com/video/av123456', // Should not match
    'https://example.com/video/BV1zGMJzsExz' // Should not match
  ];

  testUrls.forEach(url => {
    const bvMatch = url.match(/\/video\/(BV[0-9A-Za-z]+)/);
    if (bvMatch) {
      const bvCode = bvMatch[1];
      const apiBvCode = bvCode.substring(2);
      console.log(`URL: ${url}`);
      console.log(`BV Code: ${bvCode}`);
      console.log(`API BV Code: ${apiBvCode}`);
      console.log('---');
    } else {
      console.log(`No match for: ${url}`);
      console.log('---');
    }
  });
}

// Test API call
async function testApiCall() {
  const apiBvCode = '1zGMJzsExz';
  const apiUrl = `https://api.injahow.cn/bparse/?bv=${apiBvCode}&otype=url`;
  try {
    console.log('Testing API call with BV code:', apiBvCode);
    const response = await fetch(apiUrl);
    console.log('Response status:', response.status);
    if (response.ok) {
      const mp4Url = await response.text();
      console.log('API Response (MP4 URL):', mp4Url);
      console.log('Is valid URL:', mp4Url.startsWith('http'));
    } else {
      console.error('API request failed with status:', response.status);
    }
  } catch (error) {
    console.error('API Error:', error);
  }
}

testBvExtraction();
testApiCall();
