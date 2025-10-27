<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Hash;
use App\Models\User;

class AuthController extends Controller
{

    public function verifyRecaptcha(Request $request)
    {
        $token = $request->input('token');
        $version = $request->input('version', 'v3');

        \Log::info('[reCAPTCHA] verify request', [
            'version' => $version,
            'token' => substr($token, 0, 10) . '...',
        ]);

        try {
            $secret = env('RECAPTCHA_SECRET_KEY');

            $response = \Http::asForm()->post('https://www.google.com/recaptcha/api/siteverify', [
                'secret' => $secret,
                'response' => $token,
            ]);

            $result = $response->json();

            \Log::info('[reCAPTCHA] verify response', $result);

            if (!empty($result['success']) && $result['success'] === true) {
                if ($version === 'v3' && isset($result['score']) && $result['score'] < 0.5) {
                    \Log::warning('[reCAPTCHA] Low score', ['score' => $result['score']]);
                    return response()->json(['success' => false, 'message' => 'Low score'], 403);
                }
                return response()->json(['success' => true]);
            }

            \Log::warning('[reCAPTCHA] Verification failed', ['result' => $result]);
            return response()->json(['success' => false, 'message' => $result['error-codes'] ?? 'Verification failed'], 403);
        } catch (\Throwable $e) {
            \Log::error('[reCAPTCHA] Exception', ['error' => $e->getMessage()]);
            return response()->json(['success' => false, 'message' => 'Server error'], 500);
        } finally {
            \Log::channel('stack')->getLogger()->close(); // フラッシュ強制
        }
    }

    /**
     * reCAPTCHA 検証
     * POST /api/verify-recaptcha
     */
    public function verifyRecaptchaOld(Request $request)
    {
        $request->validate([
            'token' => 'required|string',
            'version' => 'required|string',
        ]);

        $token = $request->input('token');
        $version = $request->input('version');

        $secret = $version === 'v2'
            ? env('RECAPTCHA_SECRET_V2')
            : env('RECAPTCHA_SECRET_V3');

        Log::info('[reCAPTCHA] verify request', [
            'version' => $version,
            'token' => substr($token, 0, 10) . '...',
        ]);

        // Google 公式 API に問い合わせ
        $response = Http::asForm()->post(
            'https://www.google.com/recaptcha/api/siteverify',
            [
                'secret' => $secret,
                'response' => $token,
            ]
        );

        $result = $response->json();

        Log::info('[reCAPTCHA] verify response', $result);

        if (!($result['success'] ?? false)) {
            return response()->json([
                'success' => false,
                'message' => 'reCAPTCHA verification failed',
                'result' => $result,
            ], 422);
        }

        // v3 の場合はスコアチェック
        if ($version === 'v3') {
            $score = $result['score'] ?? 0;
            if ($score < 0.5) {
                Log::warning('[reCAPTCHA] v3 low score', ['score' => $score]);
                return response()->json([
                    'success' => false,
                    'message' => 'v3 score too low',
                    'score' => $score,
                ], 422);
            }
        }

        return response()->json([
            'success' => true,
            'message' => 'Verified',
            'result' => $result,
        ]);
    }

    /**
     * ログイン処理
     * POST /api/login
     */
    public function login(Request $request)
    {
        $request->validate([
            'email' => 'required|email',
            'password' => 'required|string',
        ]);

        $user = User::where('email', $request->email)->first();

        if (!$user || !Hash::check($request->password, $user->password)) {
            return response()->json(['message' => 'Invalid credentials'], 401);
        }

        // （任意）Sanctum を使用する場合
        // $token = $user->createToken('auth_token')->plainTextToken;

        Log::info('[AUTH] user logged in', ['user_id' => $user->id]);

        return response()->json([
            'message' => 'Login success',
            'user' => $user,
        ]);
    }

    /**
     * テスト用（GET /api/test）
     */
    public function test()
    {
        return response()->json([
            'ok' => true,
            'time' => now()->toDateTimeString(),
        ]);
    }
}
