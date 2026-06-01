<?php
/**
 * jsPsych Data Saving Script
 * Saves experiment data to CSV files on the server
 * Filename format: user_[USER_ID]_[TIMESTAMP].csv
 */

// Set content type for JSON response
header('Content-Type: application/json');

// Enable CORS if needed (for development)
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST');
header('Access-Control-Allow-Headers: Content-Type');

function experiment_data_directory(): string
{
    $configured = getenv('EXPERIMENT_DATA_DIR');
    if (is_string($configured) && trim($configured) !== '') {
        return $configured;
    }

    $portalConfigured = getenv('DATA_PORTAL_DATA_DIR');
    if (is_string($portalConfigured) && trim($portalConfigured) !== '') {
        return $portalConfigured;
    }

    if (basename(__DIR__) === 'dist') {
        return dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data';
    }

    return __DIR__ . DIRECTORY_SEPARATOR . 'data';
}

function ensure_experiment_data_directory(string $data_dir): void
{
    if (!is_dir($data_dir) && !mkdir($data_dir, 0755, true)) {
        throw new Exception('Failed to create data directory');
    }
}

function write_unique_data_file(string $data_dir, string $filename, string $data): array
{
    $path_info = pathinfo($filename);
    $base_name = $path_info['filename'];
    $extension = $path_info['extension'] ?? 'csv';
    $counter = 0;

    do {
        $candidate = $counter === 0 ? $filename : $base_name . '_' . $counter . '.' . $extension;
        $file_path = $data_dir . DIRECTORY_SEPARATOR . $candidate;
        $fp = @fopen($file_path, 'xb');

        if ($fp === false) {
            if (file_exists($file_path)) {
                $counter++;
                continue;
            }

            throw new Exception('Failed to create data file');
        }

        $bytes_written = 0;
        $length = strlen($data);

        try {
            while ($bytes_written < $length) {
                $written = fwrite($fp, substr($data, $bytes_written));
                if ($written === false || $written === 0) {
                    throw new Exception('Failed to write data to file');
                }
                $bytes_written += $written;
            }

            fflush($fp);
        } catch (Exception $e) {
            fclose($fp);
            @unlink($file_path);
            throw $e;
        }

        fclose($fp);

        return [
            'filename' => $candidate,
            'bytes_written' => $bytes_written,
        ];
    } while (true);
}

// Handle preflight requests
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

// Only accept POST requests
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit();
}

try {
    // Get the posted data
    $post_data = json_decode(file_get_contents('php://input'), true);
    
    // Validate required data
    if (!isset($post_data['filedata']) || !isset($post_data['filename'])) {
        throw new Exception('Missing required data: filedata and filename');
    }
    
    $data = $post_data['filedata'];
    $filename = $post_data['filename'];
    
    // Validate filename format (basic security check)
    if (!preg_match('/^user_[A-Za-z0-9]+_[\d\-T]+\.csv$/', $filename)) {
        throw new Exception('Invalid filename format');
    }
    
    // Store data outside dist when this script is copied into the build output.
    $data_dir = experiment_data_directory();
    ensure_experiment_data_directory($data_dir);
    $write_result = write_unique_data_file($data_dir, $filename, $data);
    $filename = $write_result['filename'];
    $bytes_written = $write_result['bytes_written'];
    
    // Log the save operation (optional)
    $log_entry = date('Y-m-d H:i:s') . " - Saved file: $filename (" . strlen($data) . " bytes)\n";
    file_put_contents($data_dir . '/save_log.txt', $log_entry, FILE_APPEND | LOCK_EX);
    
    // Return success response
    echo json_encode([
        'success' => true,
        'filename' => $filename,
        'size' => $bytes_written,
        'message' => 'Data saved successfully'
    ]);
    
} catch (Exception $e) {
    // Return error response
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ]);
    
    // Log the error
    $error_log = date('Y-m-d H:i:s') . " - Error: " . $e->getMessage() . "\n";
    $error_data_dir = experiment_data_directory();
    if (!is_dir($error_data_dir)) {
        @mkdir($error_data_dir, 0755, true);
    }
    @file_put_contents($error_data_dir . '/error_log.txt', $error_log, FILE_APPEND | LOCK_EX);
}
?>
