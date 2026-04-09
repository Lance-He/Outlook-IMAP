export class OutlookOAuthService {
  async refreshAccessToken(input: {
    clientId: string;
    refreshToken: string;
    tenant?: string;
  }) {
    const tenant = input.tenant || "common";
    const endpoint = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      client_id: input.clientId,
      refresh_token: input.refreshToken,
      grant_type: "refresh_token",
      scope: "https://outlook.office.com/IMAP.AccessAsUser.All offline_access"
    });

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });

    const payload = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      error?: string;
      error_description?: string;
    };

    if (!response.ok || !payload.access_token) {
      throw new Error(payload.error_description || payload.error || "微软 token 刷新失败");
    }

    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token
    };
  }
}
