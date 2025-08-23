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
    if (!preg_match('/^user_\d+_[\d\-T]+\.csv$/', $filename)) {
        throw new Exception('Invalid filename format');
    }
    
    // Ensure data directory exists
    $data_dir = __DIR__ . '/data';
    if (!file_exists($data_dir)) {
        if (!mkdir($data_dir, 0755, true)) {
            throw new Exception('Failed to create data directory');
        }
    }
    
    // Full file path
    $file_path = $data_dir . '/' . $filename;
    
    // Check if file already exists (prevent overwriting)
    if (file_exists($file_path)) {
        // Add a unique suffix if file exists
        $path_info = pathinfo($filename);
        $base_name = $path_info['filename'];
        $extension = $path_info['extension'];
        $counter = 1;
        
        do {
            $new_filename = $base_name . '_' . $counter . '.' . $extension;
            $file_path = $data_dir . '/' . $new_filename;
            $counter++;
        } while (file_exists($file_path));
        
        $filename = $new_filename;
    }
    
    // Write the data to file
    $bytes_written = file_put_contents($file_path, $data);
    
    if ($bytes_written === false) {
        throw new Exception('Failed to write data to file');
    }
    
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
    @file_put_contents(__DIR__ . '/data/error_log.txt', $error_log, FILE_APPEND | LOCK_EX);
}
?>