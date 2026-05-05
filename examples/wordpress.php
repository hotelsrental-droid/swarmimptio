<?php
/*
 * Plugin Name:       IMPT Swarm Widget
 * Plugin URI:        https://github.com/IMPTSystem/impt-swarm-widget
 * Description:       The open-source hotel-search widget that pays you 5%. Drop the [impt-swarm key="YOUR_KEY"] shortcode anywhere.
 * Version:           0.1.0
 * Author:            IMPT
 * Author URI:        https://impt.io
 * License:           MIT
 */

if (!defined('ABSPATH')) exit;

function impt_swarm_enqueue() {
    wp_enqueue_script(
        'impt-swarm',
        'https://swarm.impt.io/widget.js',
        array(),
        null,
        array('strategy' => 'async', 'in_footer' => true)
    );
}

function impt_swarm_shortcode($atts) {
    $a = shortcode_atts(array(
        'key'   => '',
        'dest'  => '',
        'cause' => 'trees',
        'theme' => 'cream',
        'title' => '',
    ), $atts, 'impt-swarm');

    if (empty($a['key'])) {
        return '<!-- impt-swarm: missing key — get one at partners.impt.io/widget -->';
    }

    impt_swarm_enqueue();

    $id = 'impt-swarm-' . wp_unique_id();
    $data = sprintf(
        'data-key="%s" data-dest="%s" data-cause="%s" data-theme="%s" data-title="%s"',
        esc_attr($a['key']),
        esc_attr($a['dest']),
        esc_attr($a['cause']),
        esc_attr($a['theme']),
        esc_attr($a['title'])
    );

    return sprintf(
        '<div id="%s"></div><script>window.addEventListener("load",function(){if(window.ImptSwarm)window.ImptSwarm.mount("#%s",{key:%s,dest:%s,cause:%s,theme:%s,title:%s});});</script>',
        esc_attr($id),
        esc_attr($id),
        wp_json_encode($a['key']),
        wp_json_encode($a['dest']),
        wp_json_encode($a['cause']),
        wp_json_encode($a['theme']),
        wp_json_encode($a['title'])
    );
}
add_shortcode('impt-swarm', 'impt_swarm_shortcode');
