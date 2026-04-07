import { NextRequest, NextResponse } from 'next/server';

const API_BASE = 'https://aglk.onrender.com';

export async function GET(request: NextRequest) {
  const path = 'api/' + (request.nextUrl.searchParams.get('path') || 'listing');
  
  try {
    const res = await fetch(`${API_BASE}/${path}`, {
      headers: {
        'Accept': 'application/json',
      },
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Proxy GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch', success: false }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const path = 'api/' + request.nextUrl.searchParams.get('path');
  
  if (!path || path === 'api/') {
    return NextResponse.json({ error: 'Path required', success: false }, { status: 400 });
  }
  
  try {
    const body = await request.json();
    console.log(`Proxying POST to: ${API_BASE}/${path}`, body);
    
    const res = await fetch(`${API_BASE}/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
    });
    
    const contentType = res.headers.get('content-type');
    let data;
    
    if (contentType && contentType.includes('application/json')) {
      data = await res.json();
    } else {
      const text = await res.text();
      data = { message: text, success: false };
    }
    
    console.log('Backend response status:', res.status);
    console.log('Backend response:', data);
    
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error('Proxy POST error:', error);
    return NextResponse.json({ error: 'Failed to connect to backend', success: false }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const path = 'api/' + request.nextUrl.searchParams.get('path');
  
  if (!path || path === 'api/') {
    return NextResponse.json({ error: 'Path required', success: false }, { status: 400 });
  }
  
  try {
    const body = await request.json();
    const res = await fetch(`${API_BASE}/${path}`, {
      method: 'PUT',
      headers: { 
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Proxy PUT error:', error);
    return NextResponse.json({ error: 'Failed to update', success: false }, { status: 500 });
  }
}